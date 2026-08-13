/**
 * WP-08-01F Task 2 — QA database topology validator.
 *
 * Verifies by PRESENCE/IDENTITY only — never prints credential values.
 */
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function checkPresent(name) {
  const val = process.env[name];
  return !!val && val.length > 10;
}

function checkPostgres(name) {
  const val = process.env[name];
  return !!val && val.startsWith("postgres");
}

async function main() {
  const results = [];

  // 1. NEXT_PUBLIC_SUPABASE_URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasUrl = checkPresent("NEXT_PUBLIC_SUPABASE_URL");
  results.push({
    check: "NEXT_PUBLIC_SUPABASE_URL present",
    pass: hasUrl,
    detail: hasUrl ? `present (length=${supabaseUrl.length})` : "MISSING or too short",
  });

  // 2. NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const hasPubKey = checkPresent("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  results.push({
    check: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY present",
    pass: hasPubKey,
    detail: hasPubKey ? `present (length=${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length})` : "MISSING or too short",
  });

  // 3. SUPABASE_SECRET_KEY
  const hasSecret = checkPresent("SUPABASE_SECRET_KEY");
  results.push({
    check: "SUPABASE_SECRET_KEY present",
    pass: hasSecret,
    detail: hasSecret ? `present (length=${process.env.SUPABASE_SECRET_KEY.length})` : "MISSING or too short",
  });

  // 4. DATABASE_URL present and PostgreSQL
  const dbUrl = process.env.DATABASE_URL;
  const hasDb = checkPostgres("DATABASE_URL");
  results.push({
    check: "DATABASE_URL present and PostgreSQL",
    pass: hasDb,
    detail: hasDb ? `present, starts with 'postgres' (length=${dbUrl.length})` : `MISSING or not postgresql:// (got: ${dbUrl ? "non-postgres" : "absent"})`,
  });

  // 5. DATABASE_URL targets the intended Supabase QA project
  let projectRefOk = false;
  let projectRefDetail = "";
  if (hasUrl && hasDb) {
    try {
      const u = new URL(supabaseUrl);
      const host = u.hostname;
      const ref = host.split(".")[0];
      if (dbUrl.includes(ref)) {
        projectRefOk = true;
        projectRefDetail = `DATABASE_URL references project ref '${ref.slice(0, 8)}...' (matches NEXT_PUBLIC_SUPABASE_URL)`;
      } else {
        projectRefOk = false;
        projectRefDetail = `DATABASE_URL does NOT reference project ref from NEXT_PUBLIC_SUPABASE_URL`;
      }
    } catch {
      projectRefDetail = "Could not parse NEXT_PUBLIC_SUPABASE_URL";
    }
  } else {
    projectRefDetail = "Cannot check — NEXT_PUBLIC_SUPABASE_URL or DATABASE_URL missing";
  }
  results.push({
    check: "DATABASE_URL targets intended Supabase QA project",
    pass: projectRefOk,
    detail: projectRefDetail,
  });

  // 6. Supabase Auth users map to application database users
  let authMappingOk = false;
  let authMappingDetail = "";
  if (hasUrl && hasSecret) {
    try {
      const { createClient } = require(resolve(process.cwd(), "node_modules/@supabase/supabase-js"));
      const supabase = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers();
      if (authErr) {
        authMappingDetail = `Auth admin API error: ${authErr.message}`;
      } else {
        const authUserIds = (authUsers.users || []).map((u) => u.id).slice(0, 5);
        let mappedCount = 0;
        let checkedCount = 0;
        for (const authId of authUserIds) {
          const { data: erpUser, error: userErr } = await supabase
            .from("users")
            .select("id, auth_id, email")
            .eq("auth_id", authId)
            .maybeSingle();
          if (!userErr && erpUser) {
            mappedCount++;
          }
          checkedCount++;
        }
        authMappingOk = mappedCount > 0;
        authMappingDetail = `${mappedCount}/${checkedCount} auth users found in users table`;
      }
    } catch (e) {
      authMappingDetail = `Error: ${e.message}`;
    }
  } else {
    authMappingDetail = "Cannot check — SUPABASE_URL or SUPABASE_SECRET_KEY missing";
  }
  results.push({
    check: "Supabase Auth users map to application database",
    pass: authMappingOk,
    detail: authMappingDetail,
  });

  // 7. migration 0018 exists in the target database
  let migrationOk = false;
  let migrationDetail = "";
  if (hasDb && dbUrl.includes("supabase")) {
    try {
      const postgres = require(resolve(process.cwd(), "node_modules/postgres"));
      const sql = postgres(dbUrl, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
      try {
        const rows = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations WHERE hash LIKE '%0018%' ORDER BY created_at DESC LIMIT 5`;
        if (rows.length > 0) {
          migrationOk = true;
          migrationDetail = `migration 0018 found in __drizzle_migrations (${rows.length} rows)`;
        } else {
          migrationDetail = "migration 0018 NOT found in __drizzle_migrations";
        }
      } catch (e1) {
        try {
          const rows2 = await sql`SELECT id, hash FROM __drizzle_migrations WHERE hash LIKE '%0018%' ORDER BY id DESC LIMIT 5`;
          if (rows2.length > 0) {
            migrationOk = true;
            migrationDetail = `migration 0018 found in __drizzle_migrations (${rows2.length} rows)`;
          } else {
            migrationDetail = "migration 0018 NOT found (table exists but no matching rows)";
          }
        } catch (e2) {
          migrationDetail = `Could not query migrations table: ${e2.message}`;
        }
      }
      await sql.end();
    } catch (e) {
      migrationDetail = `DB connection error: ${e.message}`;
    }
  } else if (hasDb) {
    migrationDetail = "DATABASE_URL is local PostgreSQL (not Supabase) — cannot verify migration 0018 in QA DB";
  } else {
    migrationDetail = "Cannot check — DATABASE_URL missing";
  }
  results.push({
    check: "migration 0018 exists in target database",
    pass: migrationOk,
    detail: migrationDetail,
  });

  // ─── Report ───────────────────────────────────────────────────────────────
  console.log("=== WP-08-01F Task 2 — QA Database Topology Validation ===\n");
  let allPass = true;
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`  ${status}: ${r.check}`);
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
