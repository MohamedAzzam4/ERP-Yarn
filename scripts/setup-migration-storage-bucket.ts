/**
 * WP-08-01F MILESTONE B — Supabase private bucket setup script.
 *
 * Creates the private migration storage bucket if it doesn't exist.
 * Verifies the bucket is private (public=false).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/setup-migration-storage-bucket.ts
 *
 * This is an idempotent deployment command — safe to run multiple times.
 */
async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucketName = process.env.MIGRATION_STORAGE_BUCKET || "migration-private-files";

  if (!supabaseUrl || !supabaseKey) {
    console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }

  console.log(`Setting up private storage bucket: ${bucketName}`);
  console.log(`Supabase URL: ${supabaseUrl}`);

  // Check if bucket exists
  const checkUrl = `${supabaseUrl}/storage/v1/bucket/${bucketName}`;
  const checkResponse = await fetch(checkUrl, {
    headers: { "Authorization": `Bearer ${supabaseKey}` },
  });

  if (checkResponse.ok) {
    const bucketInfo = await checkResponse.json() as { public?: boolean; name?: string };
    if (bucketInfo.public === true) {
      console.error(`ERROR: Bucket '${bucketName}' is PUBLIC. Migration files must be private.`);
      console.error("Fix the bucket to be private before proceeding, or delete it and re-run this script.");
      process.exit(1);
    }
    console.log(`Bucket '${bucketName}' already exists and is private. OK.`);
    process.exit(0);
  }

  // Create the bucket as private
  const createUrl = `${supabaseUrl}/storage/v1/bucket`;
  const createResponse = await fetch(createUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: bucketName,
      name: bucketName,
      public: false, // PRIVATE bucket — never public
      file_size_limit: 10 * 1024 * 1024, // 10 MB
      allowed_mime_types: ["text/csv", "application/csv", "text/plain"],
    }),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    console.error(`Failed to create bucket: ${createResponse.status} ${errorText}`);
    process.exit(1);
  }

  console.log(`Bucket '${bucketName}' created as PRIVATE with 10MB size limit.`);
  console.log("Allowed MIME types: text/csv, application/csv, text/plain");
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
