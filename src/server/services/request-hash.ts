/**
 * Stable request hashing helper for idempotency.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.8
 *   "Same key/same request returns the prior durable result; same key/
 *    different request conflicts."
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §7
 *   "Same key/same request returns stored result. Same key/different
 *    request returns conflict."
 *
 * Contract: docs/contracts/09_api_contracts.md §5
 *   "Idempotency-Key header required."
 *
 * The request hash is a stable, deterministic SHA-256 of the canonical
 * JSON representation of the request body. It is used by the idempotency
 * service to detect "same key, different request" conflicts.
 *
 * Design principles:
 *   1. DETERMINISTIC: The same request body always produces the same hash,
 *      regardless of key insertion order or whitespace.
 *   2. OPAQUE: The hash does not reveal the request contents (one-way).
 *   3. NO SECRETS: Secret fields (password, token, etc.) are STRIPPED
 *      before hashing so they never enter the hash.
 *   4. NO AUTHORITY FIELDS: tenant_id, role, permission, approver, actor,
 *      user_id, auth_id are STRIPPED before hashing (Contract 09 §5).
 */
import "server-only";
import { createHash } from "node:crypto";
import { UNIVERSAL_DENIED_FIELD_KEYS } from "@/server/security/redaction";
import { AUTHORITY_CLAIMING_BODY_FIELDS } from "@/server/security/guards";

const STRIPPED_FIELDS: ReadonlySet<string> = new Set([
  ...UNIVERSAL_DENIED_FIELD_KEYS,
  ...AUTHORITY_CLAIMING_BODY_FIELDS,
]);

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function stripSecretAndAuthorityFields<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripSecretAndAuthorityFields(item)) as unknown as T;
  }
  if (typeof value === "object" && value.constructor === Object) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (STRIPPED_FIELDS.has(key)) continue;
      result[key] = stripSecretAndAuthorityFields((value as Record<string, unknown>)[key]);
    }
    return result as unknown as T;
  }
  return value;
}

export function computeRequestHash(requestBody: unknown): string {
  const stripped = stripSecretAndAuthorityFields(requestBody);
  const canonical = canonicalJson(stripped);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function requestHashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export { STRIPPED_FIELDS as HASH_STRIPPED_FIELDS };
