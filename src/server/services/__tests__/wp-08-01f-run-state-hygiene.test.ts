/**
 * Validates that RUN-STATE.json contains no secrets and has all required fields.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const RUN_STATE_PATH = resolve(
  __dirname,
  "../../../../docs/ui-ux/evidence/wp-08-01f/runs/qaB-r9-1786647635/RUN-STATE.json",
);

const REQUIRED_FIELDS = [
  "runId", "batchId", "tenantId", "completedStage", "nextStage",
  "batchStatus", "validationStatus", "reconciliationStatus",
  "file", "stagedDataHash", "manifest", "reconciliation",
  "unresolvedReviewItems", "evidenceDir", "serverGitSha",
  "b1dCommand", "lastVerifiedAt",
];

describe("RUN-STATE.json tracked recovery state", () => {
  const content = existsSync(RUN_STATE_PATH) ? readFileSync(RUN_STATE_PATH, "utf-8") : "";
  const data = content ? JSON.parse(content) : {};

  it("file exists", () => {
    expect(existsSync(RUN_STATE_PATH)).toBe(true);
  });

  it("contains all required fields", () => {
    for (const field of REQUIRED_FIELDS) {
      expect(data, `missing field: ${field}`).toHaveProperty(field);
    }
  });

  it("completedStage is B1c", () => {
    expect(data.completedStage).toBe("B1c");
  });

  it("nextStage is B1d", () => {
    expect(data.nextStage).toBe("B1d");
  });

  it("batchStatus is review_required", () => {
    expect(data.batchStatus).toBe("review_required");
  });

  it("validationStatus is passed", () => {
    expect(data.validationStatus).toBe("passed");
  });

  it("reconciliationStatus is matched", () => {
    expect(data.reconciliationStatus).toBe("matched");
  });

  it("contains no connection strings with passwords", () => {
    expect(content).not.toMatch(/postgresql:\/\/[^:]+:[^@]+@/i);
    expect(content).not.toMatch(/postgres:\/\/[^:]+:[^@]+@/i);
  });

  it("contains no Supabase secret keys", () => {
    expect(content).not.toMatch(/sb_secret_/i);
  });

  it("contains no GitHub tokens", () => {
    expect(content).not.toMatch(/github_pat_/i);
    expect(content).not.toMatch(/ghp_[a-z0-9]/i);
  });

  it("contains no password/token/secret/cookie values", () => {
    expect(content).not.toMatch(/"password"\s*:/i);
    expect(content).not.toMatch(/"token"\s*:/i);
    expect(content).not.toMatch(/"secret"\s*:/i);
    expect(content).not.toMatch(/"cookie"\s*:/i);
    expect(content).not.toMatch(/"apiKey"\s*:/i);
    expect(content).not.toMatch(/"jwt"\s*:/i);
  });

  it("contains no database URL values", () => {
    expect(content).not.toMatch(/"databaseUrl"\s*:/i);
    expect(content).not.toMatch(/"connectionString"\s*:/i);
  });

  it("b1dCommand contains redacted credentials", () => {
    expect(data.b1dCommand).toContain("<redacted>");
    expect(data.b1dCommand).toContain("B1d");
  });

  it("b1dCommand requires explicit stage argument", () => {
    // The command must contain "B1d" as a stage argument, not a bare script call
    expect(data.b1dCommand).toMatch(/B1d\s/);
  });

  it("has file with id, version, and checksum", () => {
    expect(data.file).toHaveProperty("id");
    expect(data.file).toHaveProperty("version");
    expect(data.file).toHaveProperty("checksum");
    expect(data.file.checksum.length).toBeGreaterThan(10);
  });

  it("has manifest with id, version, and hash", () => {
    expect(data.manifest).toHaveProperty("id");
    expect(data.manifest).toHaveProperty("version");
    expect(data.manifest).toHaveProperty("hash");
    expect(data.manifest.hash.length).toBeGreaterThan(10);
  });

  it("has reconciliation with reportVersion and resultIds", () => {
    expect(data.reconciliation).toHaveProperty("reportVersion");
    expect(data.reconciliation).toHaveProperty("resultIds");
    expect(Array.isArray(data.reconciliation.resultIds)).toBe(true);
  });

  it("has unresolved review items array", () => {
    expect(Array.isArray(data.unresolvedReviewItems)).toBe(true);
  });
});
