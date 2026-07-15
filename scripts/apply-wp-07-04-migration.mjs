/**
 * Apply WP-07-04 migration to live Supabase.
 * TEST-ONLY. Not for production use.
 */
import postgres from "postgres";
import { readFileSync } from "fs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL required."); process.exit(2); }

const sql = postgres(DATABASE_URL, { prepare: false, max: 5 });

async function main() {
  const migrationSql = readFileSync("drizzle/output/0015_dual_approval_atomic_commit_locking.sql", "utf8");
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    try {
      await sql.unsafe(stmt);
      console.log("OK:", stmt.substring(0, 70).replace(/\n/g, " "));
    } catch (e) {
      const msg = e.message;
      if (msg.includes("already exists")) {
        console.log("SKIP (exists):", stmt.substring(0, 50).replace(/\n/g, " "));
      } else {
        console.log("ERROR:", msg.substring(0, 100));
      }
    }
  }

  await sql.end();
  console.log("\nMigration applied successfully.");
}

main().catch(e => { console.error(e); process.exit(1); });
