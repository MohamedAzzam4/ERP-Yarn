/**
 * Sync QA tenant security data from Supabase to the local disposable DB.
 * Fetches users, roles, permissions, role_permissions, user_roles via
 * the Supabase REST API and inserts them into the local PostgreSQL DB.
 *
 * This is FOUNDATIONAL fixture setup (not workflow-state fabrication):
 *   - tenant + users + roles + permissions are the minimum needed for
 *     the ERP-Yarn server to authenticate and authorize QA users.
 *   - Workflow states (batches, files, staging rows, etc.) are produced
 *     ONLY by real service commands — never by this script.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *   LOCAL_DATABASE_URL=postgresql://... \
 *   node scripts/wp-08-01f-browser-qa/sync-qa-security.mjs
 */
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createClient } = require(resolve(process.cwd(), "node_modules/@supabase/supabase-js"));
const postgres = require(resolve(process.cwd(), "node_modules/postgres"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// WP-08-01F DEC-057 — standardized on SUPABASE_SECRET_KEY (retired the
// SUPABASE_SERVICE_ROLE_KEY fallback).
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const LOCAL_DB = process.env.LOCAL_DATABASE_URL;

const QA_TENANT = "00000000-0000-0000-0000-000000081e50";

if (!SUPABASE_URL || !SUPABASE_KEY || !LOCAL_DB) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, and LOCAL_DATABASE_URL must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const sql = postgres(LOCAL_DB, { prepare: false, max: 3 });

async function fetchAll(table, select = "*") {
  const all = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase.from(table).select(select).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`fetch ${table}: ${error.message}`);
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function main() {
  console.log(`Syncing QA tenant security data to local DB...`);
  console.log(`QA Tenant: ${QA_TENANT}`);

  // ─── Fetch from Supabase ─────────────────────────────────────────────────
  console.log("Fetching from Supabase...");
  const tenants = (await fetchAll("tenants")).filter(t => t.id === QA_TENANT);
  const users = (await fetchAll("users")).filter(u => u.tenant_id === QA_TENANT);
  const roles = (await fetchAll("roles")).filter(r => r.tenant_id === QA_TENANT);
  const userRoles = (await fetchAll("user_roles")).filter(ur => ur.tenant_id === QA_TENANT);

  // Fetch ALL permissions (they may be global, not tenant-scoped)
  const allPermissions = await fetchAll("permissions");
  // Fetch role_permissions for the QA tenant
  const allRolePerms = await fetchAll("role_permissions");
  const rolePerms = allRolePerms.filter(rp => rp.tenant_id === QA_TENANT);

  // Get the permission IDs referenced by role_permissions
  const referencedPermIds = new Set(rolePerms.map(rp => rp.permission_id));
  const permissions = allPermissions.filter(p => referencedPermIds.has(p.id));

  console.log(`  tenants: ${tenants.length}`);
  console.log(`  users: ${users.length}`);
  console.log(`  roles: ${roles.length}`);
  console.log(`  user_roles: ${userRoles.length}`);
  console.log(`  permissions (referenced): ${permissions.length}`);
  console.log(`  role_permissions: ${rolePerms.length}`);

  // ─── Insert into local DB (upsert) ───────────────────────────────────────
  console.log("Inserting into local DB...");

  // Tenant
  for (const t of tenants) {
    await sql`
      INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status, created_at, updated_at)
      VALUES (${t.id}, ${t.company_name}, ${t.default_language}, ${t.currency_code}, ${t.timezone}, ${t.status}, ${t.created_at}, ${t.updated_at})
      ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name, status = EXCLUDED.status
    `;
  }
  console.log(`  tenants: ${tenants.length} upserted`);

  // Users
  for (const u of users) {
    await sql`
      INSERT INTO users (id, tenant_id, auth_id, name, email, status, language_preference, created_at, updated_at)
      VALUES (${u.id}, ${u.tenant_id}, ${u.auth_id}, ${u.name}, ${u.email}, ${u.status}, ${u.language_preference || 'ar'}, ${u.created_at}, ${u.updated_at})
      ON CONFLICT (id) DO UPDATE SET auth_id = EXCLUDED.auth_id, name = EXCLUDED.name, email = EXCLUDED.email, status = EXCLUDED.status
    `;
  }
  console.log(`  users: ${users.length} upserted`);

  // Roles
  for (const r of roles) {
    await sql`
      INSERT INTO roles (id, tenant_id, role_code, name_ar, name_en, is_system_role, system_flag, created_at, updated_at)
      VALUES (${r.id}, ${r.tenant_id}, ${r.role_code}, ${r.name_ar}, ${r.name_en}, ${r.is_system_role}, ${r.system_flag || 'system'}, ${r.created_at}, ${r.updated_at})
      ON CONFLICT (id) DO UPDATE SET role_code = EXCLUDED.role_code, name_en = EXCLUDED.name_en
    `;
  }
  console.log(`  roles: ${roles.length} upserted`);

  // User_roles
  for (const ur of userRoles) {
    await sql`
      INSERT INTO user_roles (user_id, role_id, tenant_id, assigned_at, created_at)
      VALUES (${ur.user_id}, ${ur.role_id}, ${ur.tenant_id}, ${ur.assigned_at || new Date().toISOString()}, ${ur.created_at || new Date().toISOString()})
      ON CONFLICT DO NOTHING
    `;
  }
  console.log(`  user_roles: ${userRoles.length} upserted`);

  // Permissions
  for (const p of permissions) {
    // The local permissions table requires tenant_id, module, action, description.
    // Derive module/action from permission_key (format: "module.action" or "module.submodule.action")
    const parts = (p.permission_key || "").split(".");
    const permModule = parts[0] || "general";
    const permAction = parts.slice(1).join(".") || "view";
    await sql`
      INSERT INTO permissions (id, tenant_id, permission_key, module, action, field_key, description, created_at, updated_at)
      VALUES (${p.id}, ${QA_TENANT}, ${p.permission_key}, ${permModule}, ${permAction}, ${p.field_key || null}, ${p.description || ''}, ${p.created_at}, ${p.updated_at})
      ON CONFLICT (id) DO UPDATE SET permission_key = EXCLUDED.permission_key, module = EXCLUDED.module, action = EXCLUDED.action
    `;
  }
  console.log(`  permissions: ${permissions.length} upserted`);

  // Role_permissions
  for (const rp of rolePerms) {
    await sql`
      INSERT INTO role_permissions (role_id, permission_id, tenant_id, created_at)
      VALUES (${rp.role_id}, ${rp.permission_id}, ${rp.tenant_id}, ${rp.created_at || new Date().toISOString()})
      ON CONFLICT DO NOTHING
    `;
  }
  console.log(`  role_permissions: ${rolePerms.length} upserted`);

  // ─── Verify ───────────────────────────────────────────────────────────────
  console.log("\nVerification:");
  const localUsers = await sql`SELECT count(*)::int AS c FROM users WHERE tenant_id = ${QA_TENANT}`;
  const localRoles = await sql`SELECT count(*)::int AS c FROM roles WHERE tenant_id = ${QA_TENANT}`;
  const localUserRoles = await sql`SELECT count(*)::int AS c FROM user_roles WHERE tenant_id = ${QA_TENANT}`;
  const localRolePerms = await sql`SELECT count(*)::int AS c FROM role_permissions WHERE tenant_id = ${QA_TENANT}`;
  console.log(`  Local users: ${localUsers[0].c} (expected ${users.length})`);
  console.log(`  Local roles: ${localRoles[0].c} (expected ${roles.length})`);
  console.log(`  Local user_roles: ${localUserRoles[0].c} (expected ${userRoles.length})`);
  console.log(`  Local role_permissions: ${localRolePerms[0].c} (expected ${rolePerms.length})`);

  const allMatch = localUsers[0].c === users.length && localRoles[0].c === roles.length
    && localUserRoles[0].c === userRoles.length && localRolePerms[0].c === rolePerms.length;
  console.log(`\nResult: ${allMatch ? "SUCCESS — all security data synced" : "MISMATCH — check counts"}`);

  await sql.end();
  process.exit(allMatch ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
