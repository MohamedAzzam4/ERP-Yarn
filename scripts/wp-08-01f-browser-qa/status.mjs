/**
 * Status — report persisted batch state and next incomplete stage.
 *
 * Usage: node status.mjs <runStateFile>
 */
import { readFileSync } from "node:fs";
const file = process.argv[2];
if (!file) { console.error("Usage: node status.mjs <runStateFile>"); process.exit(1); }

try {
  const state = JSON.parse(readFileSync(file, "utf-8"));
  console.log("Run ID:", state.runId);
  console.log("Cycle:", state.cycle);
  console.log("Batch ID:", state.batchId ?? "(not created yet)");
  console.log("Completed stages:", state.completed ?? []);
  console.log("Next stage:", state.nextStage ?? "(complete)");
  console.log("Evidence dir:", state.evidenceDir ?? "(not set)");
} catch (e) {
  console.error("No run state file found or invalid:", e.message);
  process.exit(1);
}
