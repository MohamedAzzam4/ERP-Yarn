/**
 * Preflight — check credential presence without printing values.
 * Exit 0 = all present, exit 1 = missing.
 *
 * Usage: node preflight.mjs
 *
 * WP-08-01F DEC-057 — Standardized credential set. The required list is
 * EXACTLY these four environment variables:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   - SUPABASE_SECRET_KEY (the new SPA-safe secret key)
 *   - DATABASE_URL
 *
 * SUPABASE_SERVICE_ROLE_KEY is INTENTIONALLY EXCLUDED — DEC-057 retired
 * the service-role key in favor of the standard secret key for the
 * browser-QA harness. Scripts that previously read both as a fallback
 * (`process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY`)
 * have been cleaned up to read ONLY SUPABASE_SECRET_KEY.
 */
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
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
