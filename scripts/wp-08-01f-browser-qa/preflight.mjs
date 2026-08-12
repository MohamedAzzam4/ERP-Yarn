/**
 * Preflight — check credential presence without printing values.
 * Exit 0 = all present, exit 1 = missing.
 *
 * Usage: node preflight.mjs
 */
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
];

let ok = true;
for (const v of required) {
  const val = process.env[v];
  if (!val || val.length < 10) {
    console.log(`MISSING: ${v}`);
    ok = false;
  } else {
    console.log(`OK: ${v} (length=${val.length})`);
  }
}
if (ok) console.log("\nAll credentials present.");
else { console.error("\nMissing credentials — cannot proceed."); process.exit(1); }
