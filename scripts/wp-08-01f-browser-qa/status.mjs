/**
 * Status — report persisted batch state and next incomplete stage.
 * Detects if the batch was deleted (run not resumable after cleanup).
 *
 * Usage: node status.mjs <runStateFile> [DATABASE_URL]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const file = process.argv[2];
const dbUrl = process.argv[3];
if (!file) { console.error("Usage: node status.mjs <runStateFile> [DATABASE_URL]"); process.exit(1); }

try {
  const state = JSON.parse(readFileSync(file, "utf-8"));
  console.log("Run ID:", state.runId);
  console.log("Batch ID:", state.batchId ?? "(not created yet)");
  console.log("Completed stages:", state.completed ?? []);
  console.log("Next stage:", state.nextStage ?? "(complete)");
  console.log("Expected state:", state.expectedState ?? "(none)");

  // If batchId and DB URL provided, check if batch still exists
  if (state.batchId && dbUrl) {
    const postgres = require(resolve(process.cwd(), "node_modules/postgres"));
    const sql = postgres(dbUrl, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
    const r = await sql`SELECT status FROM import_batches WHERE id = ${state.batchId}`;
    await sql.end();
    if (r.length === 0) {
      console.log("\n⚠ run_not_resumable_after_cleanup — batch was deleted");
      console.log("  Do NOT resume this run. Start a new run ID.");
    } else {
      console.log("\nDB status:", r[0].status);
      if (r[0].status !== state.expectedState) {
        console.log("⚠ WARNING: DB status does not match expected state!");
      }
    }
  }
} catch (e) {
  if (e.code === "ENOENT") {
    console.error("No run state file found:", file);
  } else {
    console.error("Error:", e.message);
  }
  process.exit(1);
}
