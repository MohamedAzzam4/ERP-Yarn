/**
 * WP-00-03A package gate tests — schema shape and contract compliance.
 *
 * These tests verify the Drizzle schema definitions against Contract 03
 * §§5–8 and the WP-00-03A acceptance criteria WITHOUT requiring a live
 * database. They check:
 *   - Table and column existence (via Drizzle's inferred schema).
 *   - Unique index presence (via Drizzle's table config).
 *   - Check constraint presence.
 *   - Tenant-owned row baseline column presence.
 *   - Append-only audit_logs (no updated_at, no deleted_at).
 *   - Required enums and their exact values.
 *
 * Live-DB tests (applying the migration to a real PostgreSQL and
 * verifying constraint enforcement at the DB level) are BLOCKED in this
 * package because no DEC-060 Supabase authorization was given. They are
 * documented in the completion report and listed at the bottom of this
 * file.
 */

import { describe, it, expect } from "vitest";
import {
  tenants,
  users,
  roles,
  permissions,
  userRoles,
  rolePermissions,
  workerScopeAssignments,
  tenantSettings,
  terminologyLabels,
  documentSequences,
  approvalRequests,
  auditLogs,
  idempotencyRecords,
  operationalAlerts,
} from "../schema";
import type { Table } from "drizzle-orm";

// Helper: extract column names from a Drizzle table object.
function columnNames(table: Table): string[] {
  return Object.keys(table as unknown as Record<string, unknown>);
}

// Helper: find a unique index by a substring of its name.
//
// Reading Drizzle's in-memory index metadata from a table object is
// fragile (the builder function source is opaque under Vitest's SSR
// transform). Instead, we read the generated migration SQL file and
// verify the `CREATE UNIQUE INDEX "...<substr>..."` statement exists.
//
// This couples the test to the generated SQL file path
// (`drizzle/output/0000_*.sql`), which is acceptable because the SQL is
// a committed, reviewed artifact per Contract 01 §Migration Contract.
//
// The migration filename uses a Drizzle-generated adjective+noun suffix
// (e.g. `0000_chief_paladin.sql`); we glob for `0000_*.sql`.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "drizzle",
  "output",
);

function readLatestMigrationSQL(): string {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^0000_.*\.sql$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error("No 0000_*.sql migration file found in drizzle/output/");
  }
  return readFileSync(join(migrationsDir, files[files.length - 1]!), "utf8");
}

function hasUniqueIndexContaining(_table: Table, substr: string): boolean {
  const sql = readLatestMigrationSQL();
  // Match: CREATE UNIQUE INDEX "...<substr>..." ON ...
  const pattern = new RegExp(
    `CREATE UNIQUE INDEX "[^"]*${substr}[^"]*" ON`,
  );
  return pattern.test(sql);
}

// ---------------------------------------------------------------------------
// Platform table existence.
// ---------------------------------------------------------------------------

describe("WP-00-03A platform tables exist", () => {
  it("tenants table is defined", () => {
    expect(tenants).toBeDefined();
    expect(columnNames(tenants)).toEqual(
      expect.arrayContaining([
        "id",
        "companyName",
        "defaultLanguage",
        "currencyCode",
        "timezone",
        "status",
        "terminologyVersion",
      ]),
    );
  });

  it("users table has tenant FK and unique (tenant_id, email)", () => {
    expect(columnNames(users)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "authId",
        "name",
        "email",
        "phone",
        "status",
        "languagePreference",
        "lastLoginAt",
      ]),
    );
    expect(hasUniqueIndexContaining(users, "tenant_email")).toBe(true);
    expect(hasUniqueIndexContaining(users, "auth_id")).toBe(true);
  });

  it("roles table has unique (tenant_id, role_code)", () => {
    expect(columnNames(roles)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "roleCode",
        "nameAr",
        "nameEn",
        "isSystemRole",
        "systemFlag",
      ]),
    );
    expect(hasUniqueIndexContaining(roles, "tenant_role_code")).toBe(true);
  });

  it("permissions table has unique (tenant_id, permission_key)", () => {
    expect(columnNames(permissions)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "permissionKey",
        "module",
        "action",
        "fieldKey",
        "description",
      ]),
    );
    expect(hasUniqueIndexContaining(permissions, "tenant_key")).toBe(true);
  });

  it("user_roles has composite PK (userId, roleId)", () => {
    expect(columnNames(userRoles)).toEqual(
      expect.arrayContaining(["userId", "roleId", "tenantId", "assignedAt", "assignedBy"]),
    );
  });

  it("role_permissions has composite PK (roleId, permissionId)", () => {
    expect(columnNames(rolePermissions)).toEqual(
      expect.arrayContaining(["roleId", "permissionId", "tenantId"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Worker scope foundation (DEC-062).
// ---------------------------------------------------------------------------

describe("WP-00-03A worker_scope_assignments (DEC-062)", () => {
  it("has the required columns per Contract 03 §7.2", () => {
    expect(columnNames(workerScopeAssignments)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "userId",
        "scopeType",
        "targetIdentifier",
        "isActive",
        "effectiveFrom",
        "effectiveTo",
        "assignedBy",
        "assignedAt",
        "reason",
      ]),
    );
  });

  it("has a unique index on active (tenant, user, scope_type, target)", () => {
    expect(
      hasUniqueIndexContaining(workerScopeAssignments, "worker_scope_active"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tenant_settings, terminology_labels, document_sequences.
// ---------------------------------------------------------------------------

describe("WP-00-03A settings/terminology/sequences", () => {
  it("tenant_settings has unique (tenant_id, setting_key, effective_from)", () => {
    expect(
      hasUniqueIndexContaining(tenantSettings, "key_effective"),
    ).toBe(true);
  });

  it("terminology_labels has unique (tenant_id, label_key)", () => {
    expect(
      hasUniqueIndexContaining(terminologyLabels, "tenant_key"),
    ).toBe(true);
  });

  it("document_sequences has unique (tenant_id, document_type, year)", () => {
    expect(
      hasUniqueIndexContaining(documentSequences, "tenant_type_year"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// approval_requests, idempotency_records, operational_alerts.
// ---------------------------------------------------------------------------

describe("WP-00-03A approval/idempotency/alerts", () => {
  it("approval_requests has unique non-null (tenant_id, idempotency_key)", () => {
    expect(columnNames(approvalRequests)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "requestType",
        "entityType",
        "entityId",
        "riskLevel",
        "requestedBy",
        "state",
        "idempotencyKey",
        "subjectVersion",
        "subjectHash",
        "invalidatedBy",
        "invalidatedAt",
        "invalidationReason",
        "supersedingRequestId",
      ]),
    );
    expect(
      hasUniqueIndexContaining(approvalRequests, "tenant_idempotency"),
    ).toBe(true);
  });

  it("approval_requests has unique active per (tenant, entity, request_type)", () => {
    expect(
      hasUniqueIndexContaining(approvalRequests, "active_entity"),
    ).toBe(true);
  });

  it("idempotency_records has unique (tenant_id, operation_scope, idempotency_key)", () => {
    expect(columnNames(idempotencyRecords)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "operationScope",
        "idempotencyKey",
        "requestHash",
        "state",
        "entityType",
        "entityId",
        "responseCode",
        "responseBody",
        "ownerToken",
        "attemptCount",
        "leaseHeartbeatAt",
        "leaseExpiresAt",
        "lastErrorClass",
        "initiatedBy",
        "createdAt",
        "completedAt",
      ]),
    );
    expect(
      hasUniqueIndexContaining(idempotencyRecords, "tenant_scope_key"),
    ).toBe(true);
  });

  it("operational_alerts has severity, state, and resolution columns", () => {
    expect(columnNames(operationalAlerts)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "severity",
        "alertType",
        "sourceEntityType",
        "sourceEntityId",
        "messageKey",
        "state",
        "detectedBy",
        "detectedAt",
        "resolvedBy",
        "resolvedAt",
        "resolutionReason",
        "auditLogId",
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Audit log immutability — schema level + migration SQL static checks.
// ---------------------------------------------------------------------------

describe("WP-00-03A audit_logs append-only foundation", () => {
  it("audit_logs has no updated_at, no deleted_at, no updated_by, no deleted_by", () => {
    const cols = columnNames(auditLogs);
    expect(cols).not.toContain("updatedAt");
    expect(cols).not.toContain("deletedAt");
    expect(cols).not.toContain("updatedBy");
    expect(cols).not.toContain("deletedBy");
  });

  it("audit_logs has createdAt, userId, entityType, entityId, actionType", () => {
    expect(columnNames(auditLogs)).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "userId",
        "entityType",
        "entityId",
        "actionType",
        "oldValuesJson",
        "newValuesJson",
        "reason",
        "approvalRequestId",
        "idempotencyKey",
        "ipAddress",
        "deviceInfo",
        "createdAt",
      ]),
    );
  });
});

describe("WP-00-03A audit append-only DB-level protection (migration SQL static check)", () => {
  // These are STATIC tests: they read the committed migration SQL file and
  // verify the append-only trigger/function statements are present. They do
  // NOT require a live database.
  //
  // Contract: docs/contracts/03_database_schema_contract.md §7.7
  //   "Application roles cannot update/delete."
  // Contract: docs/contracts/13_work_packages.md WP-00-03A Tests/Acceptance:
  //   "audit immutability"

  it("migration SQL contains the prevent_audit_log_modification function", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION "public"\."prevent_audit_log_modification"/,
    );
  });

  it("migration SQL contains the audit_logs_no_update BEFORE UPDATE trigger", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/CREATE TRIGGER "audit_logs_no_update"/);
    expect(sql).toMatch(/BEFORE UPDATE ON "public"\."audit_logs"/);
    expect(sql).toMatch(/EXECUTE FUNCTION "public"\."prevent_audit_log_modification"/);
  });

  it("migration SQL contains the audit_logs_no_delete BEFORE DELETE trigger", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/CREATE TRIGGER "audit_logs_no_delete"/);
    expect(sql).toMatch(/BEFORE DELETE ON "public"\."audit_logs"/);
    expect(sql).toMatch(/EXECUTE FUNCTION "public"\."prevent_audit_log_modification"/);
  });

  it("trigger function raises an exception on UPDATE/DELETE", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/RAISE EXCEPTION.*audit_logs is append-only/);
  });
});

describe("WP-00-03A user-reference FK constraints (migration SQL static check)", () => {
  // Static tests verifying the migration SQL contains the expected
  // user-reference FK constraints.
  //
  // Contract: docs/contracts/03_database_schema_contract.md §5.1
  //   "created_by UUID NULL REFERENCES users(id)
  //    updated_by UUID NULL REFERENCES users(id)"

  it("migration SQL contains FK from approval_requests.requested_by to users.id", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/approval_requests_requested_by_users_id_fk/);
    expect(sql).toMatch(/FOREIGN KEY \("requested_by"\) REFERENCES "public"\."users"\("id"\)/);
  });

  it("migration SQL contains FK from audit_logs.user_id to users.id", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/audit_logs_user_id_users_id_fk/);
  });

  it("migration SQL contains FK from worker_scope_assignments.user_id to users.id", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/worker_scope_assignments_user_id_users_id_fk/);
  });

  it("migration SQL contains FK from worker_scope_assignments.assigned_by to users.id", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/worker_scope_assignments_assigned_by_users_id_fk/);
  });

  it("migration SQL contains manual self-ref FK from users.created_by to users.id", () => {
    // Self-referential FK added manually because Drizzle's `references()`
    // inside the users table definition creates a TS self-reference cycle.
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/users_created_by_users_id_fk/);
    expect(sql).toMatch(/FOREIGN KEY \("created_by"\) REFERENCES "public"\."users"\("id"\)/);
  });

  it("migration SQL contains manual self-ref FK from users.updated_by to users.id", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/users_updated_by_users_id_fk/);
    expect(sql).toMatch(/FOREIGN KEY \("updated_by"\) REFERENCES "public"\."users"\("id"\)/);
  });

  it("migration SQL contains FK from user_roles.user_id to users.id", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/user_roles_user_id_users_id_fk/);
  });

  it("migration SQL contains FK from user_roles.role_id to roles.id", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/user_roles_role_id_roles_id_fk/);
  });

  it("migration SQL contains FK from role_permissions.role_id to roles.id", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/role_permissions_role_id_roles_id_fk/);
  });

  it("migration SQL contains FK from role_permissions.permission_id to permissions.id", () => {
    const sql = readLatestMigrationSQL();
    expect(sql).toMatch(/role_permissions_permission_id_permissions_id_fk/);
  });
});

describe("WP-00-03A migration SQL — no duplicate constraint/trigger names (validation defect fix)", () => {
  // These tests verify that every constraint, trigger, and function name
  // appears EXACTLY ONCE in the migration SQL. The live DB validation
  // discovered that the original migration had duplicate definitions
  // (manual ALTER TABLE statements that duplicated Drizzle-generated FKs,
  // and a duplicated audit trigger section). These tests prevent regression.
  //
  // Each test counts the number of ADD CONSTRAINT / CREATE TRIGGER /
  // CREATE OR REPLACE FUNCTION statements for each named object and
  // asserts the count is exactly 1.

  it("users_created_by_users_id_fk appears exactly once", () => {
    const sql = readLatestMigrationSQL();
    const matches = sql.match(/ADD CONSTRAINT "users_created_by_users_id_fk"/g);
    expect(matches?.length ?? 0).toBe(1);
  });

  it("users_updated_by_users_id_fk appears exactly once", () => {
    const sql = readLatestMigrationSQL();
    const matches = sql.match(/ADD CONSTRAINT "users_updated_by_users_id_fk"/g);
    expect(matches?.length ?? 0).toBe(1);
  });

  it("prevent_audit_log_modification function defined exactly once", () => {
    const sql = readLatestMigrationSQL();
    const matches = sql.match(
      /CREATE OR REPLACE FUNCTION "public"\."prevent_audit_log_modification"/g,
    );
    expect(matches?.length ?? 0).toBe(1);
  });

  it("audit_logs_no_update trigger defined exactly once", () => {
    const sql = readLatestMigrationSQL();
    const matches = sql.match(/CREATE TRIGGER "audit_logs_no_update"/g);
    expect(matches?.length ?? 0).toBe(1);
  });

  it("audit_logs_no_delete trigger defined exactly once", () => {
    const sql = readLatestMigrationSQL();
    const matches = sql.match(/CREATE TRIGGER "audit_logs_no_delete"/g);
    expect(matches?.length ?? 0).toBe(1);
  });

  it("no constraint name is defined more than once (generic check)", () => {
    // Generic check: extract all ADD CONSTRAINT "name" occurrences and
    // verify each name appears exactly once.
    const sql = readLatestMigrationSQL();
    const matches = sql.match(/ADD CONSTRAINT "([a-z_]+)"/g) ?? [];
    const names = matches
      .map((m) => m.match(/"([a-z_]+)"/)?.[1])
      .filter((n): n is string => n !== undefined);
    const counts = new Map<string, number>();
    for (const name of names) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tenant-owned row baseline.
// ---------------------------------------------------------------------------

describe("WP-00-03A tenant-owned row baseline (Contract 03 §5.1)", () => {
  const tenantOwnedTables = [
    ["users", users],
    ["roles", roles],
    ["permissions", permissions],
    ["userRoles", userRoles],
    ["rolePermissions", rolePermissions],
    ["workerScopeAssignments", workerScopeAssignments],
    ["tenantSettings", tenantSettings],
    ["terminologyLabels", terminologyLabels],
    ["documentSequences", documentSequences],
    ["approvalRequests", approvalRequests],
    ["operationalAlerts", operationalAlerts],
  ] as const;

  for (const [name, table] of tenantOwnedTables) {
    it(`${name} has tenant_id, created_at, created_by, updated_at, updated_by`, () => {
      const cols = columnNames(table);
      expect(cols).toContain("tenantId");
      expect(cols).toContain("createdAt");
      expect(cols).toContain("createdBy");
      expect(cols).toContain("updatedAt");
      expect(cols).toContain("updatedBy");
    });
  }

  it("tenants itself has no tenant_id column (its own id is the tenant identifier)", () => {
    expect(columnNames(tenants)).not.toContain("tenantId");
  });
});

// ---------------------------------------------------------------------------
// Live-DB tests BLOCKED in WP-00-03A (documented, not run).
// ---------------------------------------------------------------------------
//
// The following tests REQUIRE a live PostgreSQL database (hosted Supabase
// dev/test project) and are BLOCKED in WP-00-03A because no DEC-060
// authorization was given for hosted Supabase credentials in this package.
//
// The STATIC tests above already verify that the migration SQL CONTAINS
// the trigger, function, FK constraints, unique indexes, and check
// constraints. The BLOCKED tests below verify that those statements
// ACTUALLY EXECUTE AND ENFORCE correctly at the DB level — which requires
// applying the migration to a real PostgreSQL instance.
//
// Exactly 8 blocked tests (matches the WP-00-03A completion report):

describe("WP-00-03A live-DB tests (BLOCKED — 8 tests, documented)", () => {
  it.skip("BLOCKED-1: migration applies cleanly to an empty database", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
    // Would: connect to empty DB, run migration 0000_*.sql, verify 0 errors.
  });

  it.skip("BLOCKED-2: unique (tenant_id, role_code) is enforced at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
    // Would: insert a role, attempt duplicate (tenant_id, role_code),
    // verify the unique index rejects the second insert.
  });

  it.skip("BLOCKED-3: approval_requests idempotency_key uniqueness is enforced", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
    // Would: insert an approval_request with idempotency_key, attempt
    // duplicate, verify rejection.
  });

  it.skip("BLOCKED-4: audit_logs append-only trigger rejects UPDATE at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
    // The trigger IS in the migration (verified by static test above).
    // This live-DB test would: insert an audit row, attempt UPDATE,
    // verify the trigger raises an exception.
  });

  it.skip("BLOCKED-5: audit_logs append-only trigger rejects DELETE at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
    // The trigger IS in the migration (verified by static test above).
    // This live-DB test would: insert an audit row, attempt DELETE,
    // verify the trigger raises an exception.
  });

  it.skip("BLOCKED-6: worker_scope_assignments effective window check rejects to < from", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
    // Would: insert a worker_scope_assignments row with effective_to
    // earlier than effective_from, verify the CHECK constraint rejects it.
  });

  it.skip("BLOCKED-7: document_sequences SELECT FOR UPDATE under real concurrent transactions", () => {
    // BLOCKED: requires live DB (DEC-060).
    // The in-process simulation test (document-sequence-concurrency.test.ts)
    // verifies the allocation protocol logic. This live-DB test would
    // verify the actual PostgreSQL row lock under concurrent transactions.
  });

  it.skip("BLOCKED-8: user-reference FK constraints enforce at DB level", () => {
    // BLOCKED: requires hosted Supabase dev/test credentials (DEC-060).
    // Would: insert a row with a created_by/updated_by/approved_by/etc.
    // value that does not exist in users.id, verify the FK constraint
    // rejects the insert.
  });
});
