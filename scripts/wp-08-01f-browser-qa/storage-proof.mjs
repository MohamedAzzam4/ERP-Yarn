/**
 * Storage proof helper — list/count/delete objects in the private migration bucket.
 * Resolves @supabase/supabase-js from the ERP-Yarn node_modules.
 *
 * Usage:
 *   node storage-proof.mjs <SUPABASE_URL> <SUPABASE_SERVICE_KEY> list              → list all objects
 *   node storage-proof.mjs <SUPABASE_URL> <SUPABASE_SERVICE_KEY> count             → object count
 *   node storage-proof.mjs <SUPABASE_URL> <SUPABASE_SERVICE_KEY> delete <objectKey> → delete one object
 */
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createClient } = require(resolve(process.cwd(), "node_modules/@supabase/supabase-js"));

const [url, key, mode, ...rest] = process.argv.slice(2);
const BUCKET = "migration-private-files";

async function main() {
  const supabase = createClient(url, key);

  if (mode === "count") {
    const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
    if (error) { console.error(error.message); process.exit(1); }
    // Count all objects recursively (folders + files)
    let count = 0;
    for (const item of data) {
      if (item.id) count++;
      else {
        // It's a folder — list its contents
        const { data: sub } = await supabase.storage.from(BUCKET).list(item.name, { limit: 1000 });
        if (sub) count += sub.filter((s) => s.id).length;
      }
    }
    console.log(count);
  } else if (mode === "list") {
    const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
    if (error) { console.error(error.message); process.exit(1); }
    console.log(JSON.stringify(data, null, 2));
  } else if (mode === "delete") {
    const objectKey = rest[0];
    const { error } = await supabase.storage.from(BUCKET).remove([objectKey]);
    if (error) { console.error(error.message); process.exit(1); }
    console.log("deleted");
  } else {
    console.error("Unknown mode. Use: list | count | delete <key>");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
