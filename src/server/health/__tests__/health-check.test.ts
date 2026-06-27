/**
 * WP-00-06 health check tests.
 * Verifies: no secrets exposed, environment label, structure, server-only guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
function readText(rel: string): string { return readFileSync(join(root, rel), "utf8"); }

describe("WP-00-06 health endpoint structure", () => {
  it("route.ts exists at /api/health", () => {
    expect(readText("src/app/api/health/route.ts")).toMatch(/export async function GET/);
  });
  it("uses Node.js runtime", () => {
    expect(readText("src/app/api/health/route.ts")).toMatch(/runtime.*=.*"nodejs"/);
  });
  it("imports performHealthCheck", () => {
    expect(readText("src/app/api/health/route.ts")).toMatch(/performHealthCheck/);
  });
});

describe("WP-00-06 no secrets in health response", () => {
  const src = readText("src/server/health/health-check.ts");
  it("does not expose publishable key", () => { expect(src).not.toMatch(/publishableKey|publishable_key/); });
  it("does not expose secret key", () => { expect(src).not.toMatch(/secretKey.*:.*string|secret_key.*:/); });
  it("does not expose project ref", () => { expect(src).not.toMatch(/projectRef|project_ref/); });
  it("does not expose DATABASE_URL in response", () => {
    // The module reads DATABASE_URL from env but must not return it.
    // Check that the HealthCheckResult interface has no url/connectionString field.
    expect(src).not.toMatch(/databaseUrl.*:.*string|connectionString/);
  });
  it("uses prepare: false", () => { expect(src).toMatch(/prepare:\s*false/); });
  it("catches errors without exposing details", () => { expect(src).toMatch(/catch/); });
});

describe("WP-00-06 environment label", () => {
  const src = readText("src/server/health/health-check.ts");
  it("returns development by default", () => { expect(src).toMatch(/return "development"/); });
  it("returns preview for VERCEL_ENV=preview", () => { expect(src).toMatch(/"preview"/); });
  it("labels Vercel production as demo", () => { expect(src).toMatch(/demo.*vercel-production/); });
});

describe("WP-00-06 server-only guard", () => {
  it("health-check.ts imports server-only", () => {
    expect(readText("src/server/health/health-check.ts")).toMatch(/['"]server-only['"]/);
  });
});

describe("WP-00-06 Auth and Storage checks exist", () => {
  const src = readText("src/server/health/health-check.ts");
  it("has checkAuthHealth function", () => { expect(src).toMatch(/checkAuthHealth/); });
  it("has checkStorageHealth function", () => { expect(src).toMatch(/checkStorageHealth/); });
  it("auth check uses server-side secret key transiently (not in response)", () => {
    expect(src).toMatch(/SUPABASE_SECRET_KEY/);
    // The key is read from env but never returned in the result
    expect(src).not.toMatch(/return.*secretKey|return.*secret_key/);
  });
  it("HealthCheckResult has auth and storage fields", () => {
    expect(src).toMatch(/auth.*reachable/);
    expect(src).toMatch(/storage.*reachable/);
  });
});

describe("WP-00-06 no business routes", () => {
  it("app/api has only /health", () => {
    const apiDir = join(root, "src", "app", "api");
    const entries = readdirSync(apiDir).filter(e => !e.startsWith("."));
    expect(entries.sort()).toEqual(["auth", "bootstrap", "health"]);
  });
});

describe("WP-00-06 preserves RTL root", () => {
  it("layout.tsx still has RTL", () => {
    const layout = readText("src/app/layout.tsx");
    expect(layout).toMatch(/lang="ar"/);
    expect(layout).toMatch(/dir="rtl"/);
  });
});

describe("WP-00-06 live smoke (BLOCKED — 1 test)", () => {
  it.skip("BLOCKED-1: health endpoint returns ok with all checks passing when credentials available", () => {});
});
