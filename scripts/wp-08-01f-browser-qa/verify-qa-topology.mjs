/**
 * WP-08-01F Task 1 — Real QA topology verification.
 *
 * Verifies by PRESENCE/IDENTITY only — never prints credential values.
 * Connects to the real Supabase PostgreSQL database via DATABASE_URL
 * and proves schema + migration 0018 + auth-user mapping + tenant/roles/permissions.
 */
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const postgres = require(resolve(process.cwd(), "node_modules/postgres"));

const EXPECTED_PROJECT_REF = "roewagammrhatmocvhwb";
const QA_TENANT = "00000000-0000-0000-0000-000000081e50";

function redactUrl(url) {
  try {
    const u = new URL(url);
    // Show scheme + host + path, redact password and userinfo
    return `${u.protocol}//***@${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

async function main() {
  const results = [];

  // 1-3. Check env presence (no values printed)
  const envChecks = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
  ];
  for (const name of envChecks) {
    const val = process.env[name];
    const present = !!val && val.length > 10;
    results.push({
      check: `${name} present`,
      pass: present,
      detail: present ? `present (length=${val.length})` : "MISSING or too short",
    });
  }

  // 4. DATABASE_URL starts with postgresql:// or postgres://
  const dbUrl = process.env.DATABASE_URL;
  const isPostgres = !!dbUrl && (dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://"));
  results.push({
    check: "DATABASE_URL is PostgreSQL",
    pass: isPostgres,
    detail: isPostgres ? `present, starts with postgres (redacted: ${redactUrl(dbUrl)})` : `MISSING or not postgresql:// (got: ${dbUrl ? dbUrl.slice(0, 10) + "..." : "absent"})`,
  });

  if (!isPostgres) {
    console.log("=== WP-08-01F Task 1 — QA Topology Verification ===\n");
    for (const r of results) {
      console.log(`  ${r.pass ? "PASS" : "FAIL"}: ${r.check} — ${r.detail}`);
    }
    console.log("\nRESULT: BLOCKED — DATABASE_URL is not PostgreSQL");
    process.exit(1);
  }

  // 5. DATABASE_URL targets the expected project ref
  const containsRef = dbUrl.includes(EXPECTED_PROJECT_REF);
  results.push({
    check: `DATABASE_URL targets project ref ${EXPECTED_PROJECT_REF.slice(0, 8)}...`,
    pass: containsRef,
    detail: containsRef ? "project ref found in DATABASE_URL" : "project ref NOT found in DATABASE_URL",
  });

  // 6-11. Connect to the database and verify schema/migrations/auth-mapping/tenant
  let sql;
  try {
    sql = postgres(dbUrl, { prepare: false, max: 2, connect_timeout: 15, idle_timeout: 10 });
  } catch (e) {
    results.push({ check: "DB connection", pass: false, detail: `postgres() error: ${e.message}` });
    console.log("=== WP-08-01F Task 1 — QA Topology Verification ===\n");
    for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}: ${r.check} — ${r.detail}`);
    process.exit(1);
  }

  // 6. Connection succeeds through the Supabase pooler
  try {
    const connTest = await sql`SELECT 1 AS ok`;
    const ok = connTest[0]?.ok === 1;
    results.push({
      check: "DB connection succeeds (Supabase pooler)",
      pass: ok,
      detail: ok ? "SELECT 1 returned 1" : "SELECT 1 returned unexpected result",
    });
  } catch (e) {
    results.push({ check: "DB connection succeeds (Supabase pooler)", pass: false, detail: `error: ${e.message}` });
  }

  // 7. select current_database()
  try {
    const dbResult = await sql`SELECT current_database() AS db_name`;
    const dbName = dbResult[0]?.db_name;
    results.push({
      check: "select current_database() succeeds",
      pass: !!dbName,
      detail: `current_database = '${dbName}'`,
    });
  } catch (e) {
    results.push({ check: "select current_database() succeeds", pass: false, detail: `error: ${e.message}` });
  }

  // 8. Required ERP schema exists (check key tables)
  const requiredTables = [
    "tenants", "users", "roles", "permissions", "user_roles", "role_permissions",
    "import_batches", "import_files", "import_staging_rows", "import_cutover_manifests",
    "import_validation_errors", "import_reconciliation_results", "import_human_review_items",
    "import_batch_approvals", "audit_logs", "idempotency_records", "document_sequences",
  ];
  let tableCount = 0;
  for (const table of requiredTables) {
    try {
      await sql`SELECT 1 FROM ${sql(table)} LIMIT 1`;
      tableCount++;
    } catch {
      // table missing
    }
  }
  results.push({
    check: "Required ERP schema exists",
    pass: tableCount === requiredTables.length,
    detail: `${tableCount}/${requiredTables.length} required tables accessible`,
  });

  // 9. Migration 0018 is applied (check import_cutover_manifests has manifest_version column)
  // Migration 0018 added manifest_version + is_current + superseded_at to import_cutover_manifests
  let migrationOk = false;
  let migrationDetail = "";
  try {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'import_cutover_manifests'
      AND column_name IN ('manifest_version', 'is_current', 'superseded_at', 'superseded_by')
      ORDER BY column_name
    `;
    const colNames = cols.map(c => c.column_name);
    const hasAll = ["is_current", "manifest_version", "superseded_at", "superseded_by"].every(c => colNames.includes(c));
    migrationOk = hasAll;
    migrationDetail = `manifest versioning columns: ${colNames.join(", ")}`;
  } catch (e) {
    migrationDetail = `error: ${e.message}`;
  }
  results.push({
    check: "Migration 0018 applied (manifest versioning columns exist)",
    pass: migrationOk,
    detail: migrationDetail,
  });

  // Also check the partial unique index from migration 0018
  try {
    const idx = await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'import_cutover_manifests'
      AND indexname = 'import_cutover_manifests_tenant_batch_domain_current_unique_idx'
    `;
    results.push({
      check: "Migration 0018 partial unique index exists",
      pass: idx.length > 0,
      detail: idx.length > 0 ? "index found" : "index NOT found",
    });
  } catch (e) {
    results.push({ check: "Migration 0018 partial unique index exists", pass: false, detail: `error: ${e.message}` });
  }

  // 10. Auth users map to users in THIS database
  // Get auth user IDs from Supabase auth, then check if they exist in users table
  let authMappingOk = false;
  let authMappingDetail = "";
  try {
    const { createClient } = require(resolve(process.cwd(), "node_modules/@supabase/supabase-js"));
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers();
    if (authErr) {
      authMappingDetail = `Auth admin API error: ${authErr.message}`;
    } else {
      const authUserIds = (authUsers.users || []).map(u => u.id).slice(0, 5);
      let mappedCount = 0;
      for (const authId of authUserIds) {
        // Query THIS database (not Supabase REST) for the auth_id
        const rows = await sql`SELECT id FROM users WHERE auth_id = ${authId}`;
        if (rows.length > 0) mappedCount++;
      }
      authMappingOk = mappedCount > 0;
      authMappingDetail = `${mappedCount}/${authUserIds.length} auth users found in THIS database's users table`;
    }
  } catch (e) {
    authMappingDetail = `error: ${e.message}`;
  }
  results.push({
    check: "Auth users map to users in THIS PostgreSQL database",
    pass: authMappingOk,
    detail: authMappingDetail,
  });

  // 11. Expected tenant, roles, permissions, role assignments exist
  let tenantOk = false, rolesOk = false, permsOk = false, userRolesOk = false, rolePermsOk = false;
  let tenantDetail = "", rolesDetail = "", permsDetail = "", userRolesDetail = "", rolePermsDetail = "";

  try {
    const tenant = await sql`SELECT id, company_name FROM tenants WHERE id = ${QA_TENANT}`;
    tenantOk = tenant.length > 0;
    tenantDetail = tenantOk ? `tenant found: ${tenant[0].company_name}` : "QA tenant NOT found";
  } catch (e) { tenantDetail = `error: ${e.message}`; }

  try {
    const roles = await sql`SELECT count(*)::int AS c, string_agg(role_code::text, ', ') AS codes FROM roles WHERE tenant_id = ${QA_TENANT}`;
    rolesOk = roles[0].c > 0;
    rolesDetail = `${roles[0].c} roles: ${roles[0].codes}`;
  } catch (e) { rolesDetail = `error: ${e.message}`; }

  try {
    const perms = await sql`SELECT count(*)::int AS c FROM permissions WHERE tenant_id = ${QA_TENANT}`;
    permsOk = perms[0].c > 0;
    permsDetail = `${perms[0].c} permissions`;
  } catch (e) { permsDetail = `error: ${e.message}`; }

  try {
    const ur = await sql`SELECT count(*)::int AS c FROM user_roles WHERE tenant_id = ${QA_TENANT}`;
    userRolesOk = ur[0].c > 0;
    userRolesDetail = `${ur[0].c} user_role assignments`;
  } catch (e) { userRolesDetail = `error: ${e.message}`; }

  try {
    const rp = await sql`SELECT count(*)::int AS c FROM role_permissions WHERE tenant_id = ${QA_TENANT}`;
    rolePermsOk = rp[0].c > 0;
    rolePermsDetail = `${rp[0].c} role_permission assignments`;
  } catch (e) { rolePermsDetail = `error: ${e.message}`; }

  results.push({ check: "QA tenant exists in DB", pass: tenantOk, detail: tenantDetail });
  results.push({ check: "Roles exist for QA tenant", pass: rolesOk, detail: rolesDetail });
  results.push({ check: "Permissions exist for QA tenant", pass: permsOk, detail: permsDetail });
  results.push({ check: "User-role assignments exist", pass: userRolesOk, detail: userRolesDetail });
  results.push({ check: "Role-permission assignments exist", pass: rolePermsOk, detail: rolePermsDetail });

  // Specifically check migration permissions exist
  try {
    const migPerms = await sql`
      SELECT rp.role_id, r.role_code, p.permission_key
      FROM role_permissions rp
      JOIN roles r ON rp.role_id = r.id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE rp.tenant_id = ${QA_TENANT}
      AND p.permission_key LIKE 'migration.%'
      ORDER BY r.role_code, p.permission_key
    `;
    const migOk = migPerms.length > 0;
    const migDetail = migPerms.length > 0
      ? `${migPerms.length} migration permission assignments: ${migPerms.map(m => `${m.role_code}→${m.permission_key}`).join(", ")}`
      : "NO migration.* permission assignments found";
    results.push({
      check: "Migration permissions assigned in DB",
      pass: migOk,
      detail: migDetail,
    });
  } catch (e) {
    results.push({ check: "Migration permissions assigned in DB", pass: false, detail: `error: ${e.message}` });
  }

  await sql.end();

  // ─── Report ───────────────────────────────────────────────────────────────
  console.log("=== WP-08-01F Task 1 — Real QA Topology Verification ===\n");
  let allPass = true;
  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}: ${r.check}`);
    console.log(`         ${r.detail}`);
    if (!r.pass) allPass = false;
  }
  console.log("\n" + (allPass ? "RESULT: ALL CHECKS PASS" : "RESULT: BLOCKED — see failures above"));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
