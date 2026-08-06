/**
 * WP-08-01E Milestone A — Structural Production Wiring Tests.
 *
 * Proves production server actions use DB-backed repos only, tx-scoped
 * factories, no InProcess stores, and required permissions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WORKER_ACTIONS = resolve(process.cwd(), "src/app/(worker)/worker/quality-entry/actions.ts");

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

describe("WP-08-01E Milestone A — Structural production wiring", () => {
  const actions = readFile(WORKER_ACTIONS);

  it("all 4 service constructions include transactionRunner", () => {
    const matches = actions.match(/transactionRunner/g);
    expect(matches?.length).toBeGreaterThanOrEqual(4);
  });

  it("all 4 service constructions include txFactories", () => {
    const matches = actions.match(/txFactories/g);
    expect(matches?.length).toBeGreaterThanOrEqual(4);
  });

  it("QualityTestService txFactories create tx-scoped QualityTestDbRepository", () => {
    expect(actions).toMatch(/createQualityTestRepository:\s*\(tx: unknown\)\s*=>\s*new QualityTestDbRepository\(tx as any\)/);
  });

  it("QualityTestService txFactories create tx-scoped IdempotencyDbRepository", () => {
    expect(actions).toMatch(/createIdempotency:\s*\(tx: unknown\)\s*=>\s*new IdempotencyDbRepository\(tx as any\)/);
  });

  it("QualityTestService txFactories create tx-scoped AuditDbRepository", () => {
    expect(actions).toMatch(/createAudit:\s*\(tx: unknown\)\s*=>\s*new AuditDbRepository\(tx as any\)/);
  });

  it("QualityTestService txFactories create tx-scoped DocumentSequenceDbRepository", () => {
    expect(actions).toMatch(/createDocumentSequence:\s*\(tx: unknown\)\s*=>\s*new DocumentSequenceDbRepository\(tx as any\)/);
  });

  it("ComplaintService txFactories create tx-scoped ComplaintDbRepository", () => {
    expect(actions).toMatch(/createComplaintRepository:\s*\(tx: unknown\)\s*=>\s*new ComplaintDbRepository\(tx as any\)/);
  });

  it("no InProcessDocumentSequenceStore in production actions", () => {
    expect(actions).not.toMatch(/InProcessDocumentSequenceStore/);
  });

  it("no InProcessIdempotencyStore in production actions", () => {
    expect(actions).not.toMatch(/InProcessIdempotencyStore/);
  });

  it("no InMemory*Repository in production actions", () => {
    expect(actions).not.toMatch(/InMemory.*Repository/);
  });

  it("createQualityTestAction requires quality_tests.create before service invocation", () => {
    const section = actions.match(/export async function createQualityTestAction[\s\S]*?await service\.createQualityTest/)?.[0] ?? "";
    expect(section).toMatch(/"quality_tests\.create"/);
  });

  it("recordQualityTestValueAction requires quality_tests.create before service invocation", () => {
    const section = actions.match(/export async function recordQualityTestValueAction[\s\S]*?await service\.recordQualityTestValue/)?.[0] ?? "";
    expect(section).toMatch(/"quality_tests\.create"/);
  });

  it("createComplaintAction requires complaints.investigate before service invocation", () => {
    const section = actions.match(/export async function createComplaintAction[\s\S]*?await service\.createComplaint/)?.[0] ?? "";
    expect(section).toMatch(/"complaints\.investigate"/);
  });

  it("updateComplaintAction requires complaints.investigate before service invocation", () => {
    const section = actions.match(/export async function updateComplaintAction[\s\S]*?await service\.updateComplaint/)?.[0] ?? "";
    expect(section).toMatch(/"complaints\.investigate"/);
  });
});
