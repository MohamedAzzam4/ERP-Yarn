/**
 * WP-01-03 tests — request hashing helper.
 */
import { describe, it, expect } from "vitest";
import { computeRequestHash, requestHashesMatch, HASH_STRIPPED_FIELDS } from "../request-hash";

describe("computeRequestHash — determinism", () => {
  it("returns a 64-char lowercase hex string", () => {
    expect(computeRequestHash({ foo: "bar" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same object produces same hash", () => {
    expect(computeRequestHash({ foo: "bar", n: 1 })).toBe(computeRequestHash({ foo: "bar", n: 1 }));
  });

  it("different key insertion order produces same hash (canonical JSON)", () => {
    expect(computeRequestHash({ foo: "bar", n: 1, z: true })).toBe(computeRequestHash({ z: true, foo: "bar", n: 1 }));
  });

  it("different values produce different hashes", () => {
    expect(computeRequestHash({ foo: "bar" })).not.toBe(computeRequestHash({ foo: "baz" }));
  });

  it("nested objects with different key order produce same hash", () => {
    expect(computeRequestHash({ outer: { b: 2, a: 1 } })).toBe(computeRequestHash({ outer: { a: 1, b: 2 } }));
  });

  it("arrays preserve order (not sorted)", () => {
    expect(computeRequestHash({ items: [1, 2, 3] })).not.toBe(computeRequestHash({ items: [3, 2, 1] }));
  });
});

describe("computeRequestHash — secret stripping", () => {
  it("strips password field before hashing", () => {
    expect(computeRequestHash({ username: "alice", password: "secret123" })).toBe(computeRequestHash({ username: "alice" }));
  });

  it("strips secret_key field before hashing", () => {
    expect(computeRequestHash({ data: "x", secret_key: "leak" })).toBe(computeRequestHash({ data: "x" }));
  });

  it("strips nested secret fields", () => {
    expect(computeRequestHash({ user: { name: "alice", password: "secret" } })).toBe(computeRequestHash({ user: { name: "alice" } }));
  });

  it("strips database_url field before hashing", () => {
    expect(computeRequestHash({ data: "x", database_url: "postgres://..." })).toBe(computeRequestHash({ data: "x" }));
  });

  it("HASH_STRIPPED_FIELDS contains password, secret_key, database_url", () => {
    expect(HASH_STRIPPED_FIELDS.has("password")).toBe(true);
    expect(HASH_STRIPPED_FIELDS.has("secret_key")).toBe(true);
    expect(HASH_STRIPPED_FIELDS.has("database_url")).toBe(true);
  });
});

describe("computeRequestHash — authority field stripping", () => {
  it("strips tenant_id before hashing (Contract 09 §5)", () => {
    expect(computeRequestHash({ data: "x", tenant_id: "tenant-1" })).toBe(computeRequestHash({ data: "x", tenant_id: "tenant-2" }));
  });

  it("strips tenantId (camelCase) before hashing", () => {
    expect(computeRequestHash({ data: "x", tenantId: "t1" })).toBe(computeRequestHash({ data: "x", tenantId: "t2" }));
  });

  it("strips role, permission, approver, actor, user_id, auth_id", () => {
    const withAuth = { data: "x", role: "owner", permission: "users.manage", approver: "u1", actor: "u1", user_id: "u1", auth_id: "a1" };
    expect(computeRequestHash(withAuth)).toBe(computeRequestHash({ data: "x" }));
  });
});

describe("computeRequestHash — edge cases", () => {
  it("handles null", () => { expect(computeRequestHash(null)).toMatch(/^[0-9a-f]{64}$/); });
  it("handles undefined (treated as null)", () => { expect(computeRequestHash(undefined)).toBe(computeRequestHash(null)); });
  it("handles primitives", () => { expect(computeRequestHash("string")).toMatch(/^[0-9a-f]{64}$/); });
  it("handles empty object", () => { expect(computeRequestHash({})).toMatch(/^[0-9a-f]{64}$/); });
  it("handles nested arrays with objects", () => {
    expect(computeRequestHash({ lines: [{ id: 1, qty: 5 }] })).toBe(computeRequestHash({ lines: [{ id: 1, qty: 5 }] }));
  });
  it("omits undefined values from objects", () => {
    expect(computeRequestHash({ a: 1, b: undefined })).toBe(computeRequestHash({ a: 1 }));
  });
});

describe("requestHashesMatch — constant-time comparison", () => {
  it("returns true for equal hashes", () => {
    const h = computeRequestHash({ x: 1 });
    expect(requestHashesMatch(h, h)).toBe(true);
  });
  it("returns false for different hashes", () => {
    expect(requestHashesMatch(computeRequestHash({ x: 1 }), computeRequestHash({ x: 2 }))).toBe(false);
  });
  it("returns false for different-length strings", () => {
    expect(requestHashesMatch("abc", "abcd")).toBe(false);
  });
});
