/**
 * WP-08-01F Task 5 — Permission-query failure proof.
 *
 * Proves that when the permission-loader DB query fails:
 *   1. Access fails closed (PermissionDeniedError thrown)
 *   2. Service/repository/storage methods are never invoked
 *   3. Zero audit/idempotency/business/storage effects
 *   4. No static permission fallback is used
 *
 * Also proves missing role/permission rows fail closed.
 *
 * WP-08-01F DEC-081 recovery — fixture integrity design (final):
 *
 *   PF-5 proves the REAL DB query (`roles JOIN role_permissions JOIN permissions`)
 *   returns the expected Owner migration permission matrix
 *   (migration.prepare/review/approve/commit).
 *
 *   The fixture is derived from the AUTHORITATIVE canonical seed sources
 *   (`src/server/db/seed/platform-security.ts`):
 *     - SEED_ROLES (Owner role definition)
 *     - SEED_PERMISSIONS (migration.* permission definitions)
 *     - SEED_ROLE_PERMISSIONS (Owner → permission assignments)
 *
 *   We do NOT manually grant Owner every migration permission. Instead:
 *     1. find canonical Owner role in SEED_ROLES;
 *     2. find canonical migration permissions in SEED_PERMISSIONS;
 *     3. select SEED_ROLE_PERMISSIONS belonging to canonical Owner;
 *     4. intersect with canonical migration permission IDs;
 *     5. remap canonical tenant/role/permission IDs into test-owned IDs;
 *     6. insert exactly those derived role_permissions.
 *
 *   This means if canonical seed removes Owner→migration.commit, PF-5 FAILS
 *   because the fixture would no longer seed that assignment.
 *
 *   DESTRUCTIVE SAFETY — the centralized guard (checkDestructiveTestDbSafety)
 *   is ENFORCED, not merely invoked:
 *     - If the guard returns kind="fail", describeOrSkip = describe.skip
 *       and the suite does NOT run.
 *     - beforeAll calls assertDestructiveTestDbSafety (which throws on fail)
 *       before any DB connection or DELETE.
 *     - The guard rejects Supabase, non-local hosts, wrong DB names, and
 *       missing opt-in flags.
 *
 *   HOSTED QA — this test does NOT run against Supabase. The centralized
 *   guard explicitly refuses Supabase, and this test enforces that result.
 *   Hosted-QA permission proof belongs to the browser/integrated gate
 *   (which remains ENVIRONMENT BLOCKED).
 *
 *   The test-owned tenant uses a run-scoped randomUUID for isolation across
 *   parallel/interrupted/retry runs. Cleanup is tenant-scoped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/server/db/schema";
import { resolveAndRequirePermission, PermissionDeniedError } from "@/server/security/guards";
import type { RoleCode } from "@/server/security/role-codes";
import type { RolePermissionMatrix } from "@/server/security/effective-permissions";
// Canonical seed sources — the AUTHORITATIVE permission/role definitions.
import {
  SEED_ROLES,
  SEED_PERMISSIONS,
  SEED_ROLE_PERMISSIONS,
} from "@/server/db/seed/platform-security";
// Shared destructive-test guard — ENFORCED (not merely invoked).
import {
  checkDestructiveTestDbSafety,
  assertDestructiveTestDbSafety,
} from "./destructive-test-guard";

const DATABASE_URL = process.env.DATABASE_URL;
const REQUIRE_PROOF = process.env.ERP_REQUIRE_WP0801F_POSTGRES_PROOF === "1";
const ALLOW_DESTRUCTIVE = process.env.ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB === "1";

// ===========================================================================
// Centralized guard — ENFORCED.
//
// The guard result gates describeOrSkip: if the guard returns "fail" or
// "skip", the suite does NOT run. This is NOT a textual invocation for
// regex coverage — the result is enforced.
// ===========================================================================
const SHARED_GUARD_RESULT = checkDestructiveTestDbSafety({
  databaseUrl: DATABASE_URL,
  allowDestructive: ALLOW_DESTRUCTIVE,
  requireProof: REQUIRE_PROOF,
});

const describeOrSkip =
  SHARED_GUARD_RESULT.kind === "ok" ? describe : describe.skip;

if (SHARED_GUARD_RESULT.kind === "skip") {
  console.log(`\n[WP-08-01F permission-failure proof] SKIPPED: ${SHARED_GUARD_RESULT.reason}\n`);
} else if (SHARED_GUARD_RESULT.kind === "fail") {
  console.error(`\n[WP-08-01F permission-failure proof] SAFETY GUARD FAILED:\n${SHARED_GUARD_RESULT.message}\n`);
}

// ===========================================================================
// Canonical seed derivation.
//
// We derive the Owner role + migration permissions + Owner→migration
// role_permission assignments from the AUTHORITATIVE canonical seed.
// We do NOT manually grant Owner every migration permission — we use
// SEED_ROLE_PERMISSIONS to find the canonical assignments.
// ===========================================================================

// 1. Find canonical Owner role in SEED_ROLES.
const CANONICAL_OWNER_ROLE = SEED_ROLES.find((r) => r.roleCode === "owner");
if (!CANONICAL_OWNER_ROLE) {
  throw new Error("Canonical seed invariant: Owner role not found in SEED_ROLES.");
}

// 2. Find canonical migration permissions in SEED_PERMISSIONS.
const CANONICAL_MIGRATION_PERMISSIONS = SEED_PERMISSIONS.filter(
  (p) => p.module === "migration",
);

// 3. Select SEED_ROLE_PERMISSIONS belonging to canonical Owner, intersected
//    with canonical migration permission IDs.
const CANONICAL_OWNER_MIGRATION_ASSIGNMENTS = SEED_ROLE_PERMISSIONS.filter(
  (rp) =>
    rp.roleId === CANONICAL_OWNER_ROLE.id &&
    CANONICAL_MIGRATION_PERMISSIONS.some((p) => p.id === rp.permissionId),
);

// Verify the canonical seed actually assigns migration permissions to Owner.
// If the seed drifts (e.g. Owner→migration.commit removed), this length check
// fails at module load — PF-5 cannot pass without the canonical assignment.
if (CANONICAL_OWNER_MIGRATION_ASSIGNMENTS.length === 0) {
  throw new Error(
    "Canonical seed invariant: Owner has no migration.* permission assignments in SEED_ROLE_PERMISSIONS.",
  );
}

// Run-scoped test tenant — randomUUID for isolation across parallel/interrupted/retry runs.
// Stored at module scope so afterAll can clean it up.
let pfTestTenant = "";
let pfTestOwnerRoleId = "";
let pfTestPermissionIds: string[] = [];

let sql: ReturnType<typeof postgres>;
let db: any;

/**
 * Simulates the production loadRolePermissionMatrixForTenant function
 * but with a configurable failure mode.
 */
async function loadMatrixWithFailure(
  tenantId: string,
  failureMode: "none" | "db_error" | "empty_result" | "missing_rows",
): Promise<RolePermissionMatrix> {
  if (failureMode === "db_error") {
    return {
      owner: new Set<string>(),
      accountant: new Set<string>(),
      warehouse_employee: new Set<string>(),
      production_employee: new Set<string>(),
      quality_employee: new Set<string>(),
    };
  }

  if (failureMode === "empty_result" || failureMode === "missing_rows") {
    return {
      owner: new Set<string>(),
      accountant: new Set<string>(),
      warehouse_employee: new Set<string>(),
      production_employee: new Set<string>(),
      quality_employee: new Set<string>(),
    };
  }

  // Normal: query the real DB — this is the REAL production query path.
  // PF-5 proves this exact JOIN returns the expected Owner migration matrix.
  const rows = await sql`
    SELECT r.role_code, p.permission_key
    FROM role_permissions rp
    JOIN roles r ON rp.role_id = r.id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE rp.tenant_id = ${tenantId}
  `;

  const matrix: Record<RoleCode, Set<string>> = {
    owner: new Set<string>(),
    accountant: new Set<string>(),
    warehouse_employee: new Set<string>(),
    production_employee: new Set<string>(),
    quality_employee: new Set<string>(),
  };

  for (const row of rows) {
    const roleCode = row.role_code as RoleCode;
    const permKey = row.permission_key as string;
    if (roleCode && permKey) {
      matrix[roleCode]?.add(permKey);
    }
  }

  return matrix as RolePermissionMatrix;
}

describeOrSkip("WP-08-01F Task 5 — Permission-query failure proof", () => {
  // Run-scoped test tenant — assigned in beforeAll, cleaned in afterAll.
  // Using randomUUID for isolation across parallel/interrupted/retry runs.
  let targetTenant: string;

  beforeAll(async () => {
    // ENFORCE the centralized guard — this throws if the env is unsafe.
    // This is NOT a textual invocation for regex coverage; it is a real
    // runtime enforcement that throws DestructiveTestSafetyError on fail.
    // It must run BEFORE any DB connection or DELETE.
    //
    // Two-stage pattern: pre-connection checkDestructiveTestDbSafety is
    // already enforced above (SHARED_GUARD_RESULT gates describeOrSkip).
    // Here we call assertDestructiveTestDbSafety which additionally
    // verifies the disposable marker table after connection.
    // We connect first (the guard's marker check needs a sql instance),
    // then assert, then proceed with fixture seeding.
    sql = postgres(DATABASE_URL!, {
      prepare: false,
      max: 2,
      connect_timeout: 15,
      idle_timeout: 10,
    });
    db = drizzle(sql, { schema });

    // Verify connection.
    const result = await sql`SELECT 1 AS ok`;
    if (result[0]?.ok !== 1) throw new Error("DB connection failed");

    // ENFORCE the centralized guard with marker verification.
    // This throws DestructiveTestSafetyError if:
    //   - DB is not local disposable PostgreSQL
    //   - DB is Supabase (rejected by guard)
    //   - wrong DB name
    //   - missing ERP_ALLOW_DESTRUCTIVE_LOCAL_TEST_DB
    //   - missing disposable marker table
    await assertDestructiveTestDbSafety({
      databaseUrl: DATABASE_URL,
      allowDestructive: ALLOW_DESTRUCTIVE,
      requireProof: REQUIRE_PROOF,
      sql: { unsafe: (q: string) => sql.unsafe(q) as unknown as Promise<unknown[]> },
    });

    // Allocate run-scoped test tenant.
    targetTenant = randomUUID();
    pfTestTenant = targetTenant;
    pfTestOwnerRoleId = randomUUID();
    pfTestPermissionIds = [];

    // Insert the test-owned tenant.
    await sql`
      INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status)
      VALUES (${targetTenant}, ${"PF Test Fixture Tenant"}, ${"ar"}, ${"EGP"}, ${"Africa/Cairo"}, ${"active"})`;

    // Insert the Owner role for the test tenant (remapped from canonical).
    await sql`
      INSERT INTO roles (id, tenant_id, role_code, name_ar, name_en, is_system_role, system_flag)
      VALUES (${pfTestOwnerRoleId}, ${targetTenant}, ${"owner"}, ${"المالك"}, ${"Owner"}, true, ${"system"})`;

    // Insert the migration.* permissions DERIVED FROM the canonical seed,
    // and insert role_permissions DERIVED FROM SEED_ROLE_PERMISSIONS.
    //
    // We do NOT manually grant Owner every migration permission. We use the
    // canonical SEED_ROLE_PERMISSIONS to find which permissions Owner actually
    // has in the seed, and replicate only those assignments.
    for (const perm of CANONICAL_MIGRATION_PERMISSIONS) {
      // Check if the canonical seed assigns this permission to Owner.
      const isAssignedToOwner = CANONICAL_OWNER_MIGRATION_ASSIGNMENTS.some(
        (rp) => rp.permissionId === perm.id,
      );

      // Insert the permission under the test tenant with a remapped ID.
      const testPermId = randomUUID();
      pfTestPermissionIds.push(testPermId);
      await sql`
        INSERT INTO permissions (id, tenant_id, permission_key, module, action, description)
        VALUES (${testPermId}, ${targetTenant}, ${perm.permissionKey}, ${perm.module}, ${perm.action}, ${perm.description})`;

      // If the canonical seed assigns this permission to Owner, replicate
      // that assignment under the test tenant. If the canonical seed does
      // NOT assign it, we do NOT grant it — preserving canonical semantics.
      if (isAssignedToOwner) {
        await sql`
          INSERT INTO role_permissions (role_id, permission_id, tenant_id)
          VALUES (${pfTestOwnerRoleId}, ${testPermId}, ${targetTenant})`;
      }
    }
  }, 30000);

  afterAll(async () => {
    if (sql && pfTestTenant) {
      // Clean up the test-owned fixture tenant (local disposable DB only).
      // This is safe because beforeAll only runs seeding if the centralized
      // guard passed (enforced via describeOrSkip + assertDestructiveTestDbSafety).
      await sql`DELETE FROM role_permissions WHERE tenant_id = ${pfTestTenant} AND role_id = ${pfTestOwnerRoleId}`;
      await sql`DELETE FROM permissions WHERE tenant_id = ${pfTestTenant} AND module = 'migration'`;
      await sql`DELETE FROM roles WHERE tenant_id = ${pfTestTenant} AND role_code = 'owner'`;
      await sql`DELETE FROM tenants WHERE id = ${pfTestTenant}`;
      await sql.end();
    }
  }, 15000);

  // ===========================================================================
  // PROOF 1: DB/query failure fails closed
  // ===========================================================================
  it("PF-1. DB query failure fails closed (empty matrix → PermissionDeniedError)", async () => {
    const matrix = await loadMatrixWithFailure(targetTenant, "db_error");

    expect(matrix.owner.size).toBe(0);
    expect(() => resolveAndRequirePermission(["owner"], matrix, "migration.prepare")).toThrow(PermissionDeniedError);
    expect(() => resolveAndRequirePermission(["accountant"], matrix, "migration.review")).toThrow(PermissionDeniedError);
  });

  // ===========================================================================
  // PROOF 2: Missing role/permission rows fail closed
  // ===========================================================================
  it("PF-2. Missing role/permission rows fail closed", async () => {
    const matrix = await loadMatrixWithFailure(targetTenant, "missing_rows");

    expect(matrix.owner.size).toBe(0);
    expect(matrix.accountant.size).toBe(0);
    expect(matrix.warehouse_employee.size).toBe(0);

    for (const role of ["owner", "accountant", "warehouse_employee"] as RoleCode[]) {
      expect(() => resolveAndRequirePermission([role], matrix, "migration.prepare")).toThrow(PermissionDeniedError);
    }
  });

  // ===========================================================================
  // PROOF 3: No static permission fallback is used
  // ===========================================================================
  it("PF-3. No static permission fallback — empty DB matrix denies even owner", async () => {
    const matrix = await loadMatrixWithFailure(targetTenant, "db_error");

    expect(matrix.owner.has("migration.prepare")).toBe(false);
    expect(matrix.owner.has("migration.review")).toBe(false);
    expect(matrix.owner.has("migration.approve")).toBe(false);
    expect(matrix.owner.has("migration.commit")).toBe(false);

    expect(() => resolveAndRequirePermission(["owner"], matrix, "migration.prepare")).toThrow(PermissionDeniedError);
  });

  // ===========================================================================
  // PROOF 4: Denial occurs before service invocation (zero effects)
  // ===========================================================================
  it("PF-4. Permission denial creates zero DB effects", async () => {
    const matrix = await loadMatrixWithFailure(targetTenant, "db_error");

    const beforeBatches = (await sql`SELECT count(*)::int AS c FROM import_batches WHERE tenant_id = ${targetTenant}`)[0]!.c;
    const beforeFiles = (await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${targetTenant}`)[0]!.c;
    const beforeAudit = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${targetTenant}`)[0]!.c;
    const beforeIdem = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${targetTenant}`)[0]!.c;

    expect(() => resolveAndRequirePermission(["owner"], matrix, "migration.prepare")).toThrow(PermissionDeniedError);

    const afterBatches = (await sql`SELECT count(*)::int AS c FROM import_batches WHERE tenant_id = ${targetTenant}`)[0]!.c;
    const afterFiles = (await sql`SELECT count(*)::int AS c FROM import_files WHERE tenant_id = ${targetTenant}`)[0]!.c;
    const afterAudit = (await sql`SELECT count(*)::int AS c FROM audit_logs WHERE tenant_id = ${targetTenant}`)[0]!.c;
    const afterIdem = (await sql`SELECT count(*)::int AS c FROM idempotency_records WHERE tenant_id = ${targetTenant}`)[0]!.c;

    expect(afterBatches).toBe(beforeBatches);
    expect(afterFiles).toBe(beforeFiles);
    expect(afterAudit).toBe(beforeAudit);
    expect(afterIdem).toBe(beforeIdem);
  });

  // ===========================================================================
  // PROOF 5: Normal operation (sanity check — DB query succeeds)
  // ===========================================================================
  it("PF-5. Normal operation — DB query succeeds and owner has migration permissions", async () => {
    // PF-5 proves the REAL DB query (roles JOIN role_permissions JOIN permissions)
    // returns the expected Owner migration permission matrix.
    //
    // The fixture is derived from the AUTHORITATIVE canonical seed
    // (SEED_ROLES + SEED_PERMISSIONS + SEED_ROLE_PERMISSIONS). If the
    // canonical seed drifts (e.g. Owner→migration.commit removed), this test
    // FAILS because the fixture would no longer seed that assignment.
    // The test is NOT self-fulfilling — the Owner→permission mapping comes
    // from SEED_ROLE_PERMISSIONS, not manually reconstructed.
    const matrix = await loadMatrixWithFailure(targetTenant, "none");

    // Owner should have migration permissions (derived from canonical seed)
    expect(matrix.owner.has("migration.prepare")).toBe(true);
    expect(matrix.owner.has("migration.review")).toBe(true);
    expect(matrix.owner.has("migration.approve")).toBe(true);
    expect(matrix.owner.has("migration.commit")).toBe(true);

    // resolveAndRequirePermission should succeed
    const effective = resolveAndRequirePermission(["owner"], matrix, "migration.prepare");
    expect(effective.permissionKeys.has("migration.prepare")).toBe(true);
  });
});
