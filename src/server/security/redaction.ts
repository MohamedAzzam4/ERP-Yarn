/**
 * Role-safe DTO and field-redaction helpers.
 *
 * Contract: docs/contracts/11_permission_matrix.md §11 "Backend Enforcement
 *   and Filtering"
 *   "selects only allowed fields or maps role-safe DTO"
 *   "Never fetch all financial fields and rely on UI hiding. Worker
 *    responses omit restricted properties, including nested snapshots,
 *    errors, exports and chart aggregates."
 *
 * Contract: docs/contracts/11_permission_matrix.md §8 "Field-Level
 *   Permission Matrix"
 *   Workers are redacted on every financial field group. Owner/Accountant
 *   see financial fields (with Accountant having a narrower audit-value
 *   restriction).
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md §7
 *   "assert forbidden properties are absent, not merely null/hidden"
 *
 * DEC-063: Worker financial-deny is absolute and non-overridable. If any
 *   assigned role is a Worker-family role, financial fields remain denied
 *   across UI, API, nested data, exports, logs and errors.
 *
 * WP-01-02 scope: pure redaction functions. No I/O, no DB.
 *
 * Design principle: REDACT, do not NULL. A redacted field is ABSENT from
 * the response object (deleted key), not set to null. This is critical
 * because Contract 12 §7 explicitly requires that "forbidden properties
 * are absent, not merely null/hidden". Setting to null would leak the
 * field's existence.
 */
import "server-only";

import type { EffectivePermissions } from "./effective-permissions";
import { deniedFieldKeys } from "./effective-permissions";
import type { RoleCode } from "./role-codes";
import { isWorkerRole } from "./role-codes";
import { WORKER_DENIED_FIELD_KEYS } from "./worker-financial-deny";

// ---------------------------------------------------------------------------
// 1. Core redaction primitive.
// ---------------------------------------------------------------------------

/**
 * Redact forbidden field keys from an object by DELETING them.
 *
 * This is the core primitive. It mutates a shallow copy of the input
 * object and returns it. Forbidden keys are REMOVED (not set to null),
 * per Contract 12 §7: "forbidden properties are absent, not merely
 * null/hidden".
 *
 * For nested objects/arrays, use `redactFieldsDeep` instead.
 *
 * @param obj - The object to redact. A shallow copy is made; the input
 *   is not mutated.
 * @param forbiddenKeys - The set of field keys to remove.
 * @returns A new object with forbidden keys absent.
 */
export function redactFields<T extends Record<string, unknown>>(
  obj: T,
  forbiddenKeys: ReadonlySet<string>,
): Partial<T> {
  const result: Record<string, unknown> = { ...obj };
  for (const key of Object.keys(result)) {
    if (forbiddenKeys.has(key)) {
      delete result[key];
    }
  }
  return result as Partial<T>;
}

/**
 * Deeply redact forbidden field keys from an object, including nested
 * objects and arrays.
 *
 * Traverses the object recursively. For each object node, removes any key
 * in `forbiddenKeys`. For each array element, recurses into it.
 *
 * Use this for DTOs with nested financial snapshots (e.g. a sales order
 * with nested `lines[]` each containing `net_revenue`).
 *
 * IMPORTANT: This function does NOT handle Maps, Sets, or class
 * instances. It only handles plain objects and arrays. If your DTO
 * contains those, redact them manually before calling this.
 *
 * @param value - The value to redact (object, array, or primitive).
 * @param forbiddenKeys - The set of field keys to remove at every level.
 * @returns A new value with forbidden keys absent at every level.
 */
export function redactFieldsDeep<T>(value: T, forbiddenKeys: ReadonlySet<string>): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactFieldsDeep(item, forbiddenKeys)) as unknown as T;
  }
  if (typeof value === "object" && value.constructor === Object) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (forbiddenKeys.has(key)) {
        continue; // omit entirely
      }
      result[key] = redactFieldsDeep(
        (value as Record<string, unknown>)[key],
        forbiddenKeys,
      );
    }
    return result as unknown as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// 2. Role-based redactor factory.
// ---------------------------------------------------------------------------

/**
 * A redactor function: takes a value, returns a redacted copy.
 */
export type Redactor<T> = (value: T) => T;

/**
 * Create a redactor for a user based on their effective permissions.
 *
 * The redactor removes all field keys that the user is denied. For
 * Worker-family users (DEC-063), this is the full
 * WORKER_DENIED_FIELD_KEYS set. For Owner/Accountant without a Worker
 * role, this is the empty set (no redaction by this layer — role-specific
 * Accountant audit-value restrictions are handled separately).
 *
 * Use the returned redactor on response DTOs BEFORE sending them to the
 * client. The redactor uses `redactFieldsDeep` so nested objects and
 * arrays are handled.
 *
 * @param effective - The user's resolved effective permissions.
 */
export function createRoleRedactor(
  effective: EffectivePermissions,
): <T>(value: T) => T {
  const denied = deniedFieldKeys(effective);
  if (denied.size === 0) {
    // No redaction needed — return identity function for efficiency.
    return <T>(value: T): T => value;
  }
  return <T>(value: T): T => redactFieldsDeep(value, denied);
}

// ---------------------------------------------------------------------------
// 3. Role-specific redaction patterns (Contract 11 §8).
// ---------------------------------------------------------------------------

/**
 * Accountant-specific denied field keys.
 *
 * Per Contract 11 §8 "Field-Level Permission Matrix":
 *   - "Audit financial old/new values" → Accountant = "authorized V"
 *     (not full visibility — restricted to authorized scope).
 *   - "Backup evidence" → Accountant = "authorized V".
 *
 * The MVP does NOT implement fine-grained "authorized V" scoping for
 * Accountant audit values (that requires audit-scope assignment which
 * is a future package). For MVP, Accountant sees audit values but
 * CANNOT see raw credential/secret fields (no application role sees
 * those per Contract 11 §8 last row: "Secrets/credentials → no
 * application role").
 *
 * This set is intentionally empty for MVP — Accountant redaction is
 * handled by the Worker ceiling (if applicable) and the universal
 * secret-field redaction (below).
 */
export const ACCOUNTANT_DENIED_FIELD_KEYS: ReadonlySet<string> = new Set();

/**
 * Universal denied field keys — NO application role may see these.
 *
 * Per Contract 11 §8 last row: "Secrets/credentials → no application
 * role → no".
 *
 * These are redacted from EVERY response, regardless of role. This is
 * a defense-in-depth backstop; secrets should never be selected from
 * the DB in the first place, but if they leak into a DTO, this
 * redaction strips them.
 */
export const UNIVERSAL_DENIED_FIELD_KEYS: ReadonlySet<string> = new Set([
  "password",
  "password_hash",
  "secret_key",
  "service_role_key",
  "supabase_secret_key",
  "owner_bootstrap_secret",
  "vercel_token",
  "github_token",
  "database_url",
  "connection_string",
  "api_key",
  "private_key",
  "session_token",
  "refresh_token",
]);

/**
 * Create a universal redactor that strips secret/credential fields.
 *
 * Apply this to EVERY response, regardless of role. It is the
 * defense-in-depth backstop for secret leakage.
 */
export function createUniversalSecretRedactor(): <T>(value: T) => T {
  return <T>(value: T): T => redactFieldsDeep(value, UNIVERSAL_DENIED_FIELD_KEYS);
}

// ---------------------------------------------------------------------------
// 4. Error response redaction.
// ---------------------------------------------------------------------------

/**
 * Redact forbidden field keys from an error object.
 *
 * Per Contract 11 §11: "Worker responses omit restricted properties,
 * including nested snapshots, errors, exports and chart aggregates."
 *
 * Errors often carry `cause`, `context`, `details`, or `metadata` fields
 * that may contain entity data. This function redacts forbidden keys
 * from those nested fields.
 *
 * Use this when constructing error responses for the client. Internal
 * error logging should retain the full error for debugging.
 *
 * @param error - The error object to redact (must be serializable).
 * @param forbiddenKeys - The set of field keys to remove.
 * @returns A new object safe to send to the client.
 */
export function redactError(
  error: Record<string, unknown>,
  forbiddenKeys: ReadonlySet<string>,
): Record<string, unknown> {
  return redactFieldsDeep(error, forbiddenKeys);
}

/**
 * Create an error redactor for a user based on their effective permissions.
 *
 * Combines the user's denied field keys (Worker ceiling) with the
 * universal secret-field keys.
 */
export function createErrorRedactor(
  effective: EffectivePermissions,
): (error: Record<string, unknown>) => Record<string, unknown> {
  const denied = deniedFieldKeys(effective);
  const combined = new Set<string>([...denied, ...UNIVERSAL_DENIED_FIELD_KEYS]);
  return (error: Record<string, unknown>): Record<string, unknown> =>
    redactFieldsDeep(error, combined);
}

// ---------------------------------------------------------------------------
// 5. Export / chart aggregate redaction.
// ---------------------------------------------------------------------------

/**
 * Redact forbidden field keys from an export rowset.
 *
 * Per Contract 11 §14: "Exports are internal reports restricted to
 * Owner/Accountant. Apply the same row/field permissions and audit
 * actor/filters/time/type where required. Workers cannot bypass through
 * hidden URLs."
 *
 * Exports are arrays of row objects. This function maps each row through
 * `redactFieldsDeep` with the user's denied field keys.
 *
 * @param rows - The export rowset (array of objects).
 * @param forbiddenKeys - The set of field keys to remove from each row.
 * @returns A new array with redacted rows.
 */
export function redactExportRows<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  forbiddenKeys: ReadonlySet<string>,
): Partial<T>[] {
  return rows.map((row) => redactFieldsDeep(row, forbiddenKeys) as Partial<T>);
}

/**
 * Redact forbidden field keys from a chart aggregate.
 *
 * Per Contract 11 §11: "Worker responses omit restricted properties,
 * including ... chart aggregates."
 *
 * Chart aggregates are objects like `{ labels: string[], datasets: [{
 * label, data }] }`. Financial chart datasets may contain values that
 * Workers must not see. This function redacts forbidden keys from the
 * chart object and its nested datasets.
 *
 * For chart aggregates, the common pattern is that an entire dataset
 * represents a financial metric (e.g. `profit_amount`). In that case,
 * the dataset object should be REMOVED, not just its `data` field.
 * This function handles both cases:
 *   - If a forbidden key appears as a top-level field on the chart
 *     object, it is removed.
 *   - If a forbidden key appears as a `metric` or `label` field on a
 *     dataset, the entire dataset is removed.
 *
 * @param chart - The chart aggregate object.
 * @param forbiddenKeys - The set of field keys to remove.
 * @returns A new chart object with forbidden data absent.
 */
export function redactChart(
  chart: Record<string, unknown>,
  forbiddenKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const result = redactFieldsDeep(chart, forbiddenKeys);

  // Also scan datasets for forbidden metric labels and remove the
  // entire dataset if found.
  if (Array.isArray(result.datasets)) {
    result.datasets = result.datasets.filter(
      (dataset: unknown) => {
        if (typeof dataset !== "object" || dataset === null) return true;
        const ds = dataset as Record<string, unknown>;
        const metric = ds.metric ?? ds.label ?? ds.key;
        if (typeof metric === "string" && forbiddenKeys.has(metric)) {
          return false; // remove this dataset entirely
        }
        return true;
      },
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// 6. Convenience: full response redaction pipeline.
// ---------------------------------------------------------------------------

/**
 * Redact a response DTO for a user, applying:
 *   1. Worker financial-deny ceiling (DEC-063) — if applicable.
 *   2. Universal secret-field redaction (always).
 *
 * Use this as the final step before serializing a response to the client.
 *
 * @param value - The response DTO.
 * @param effective - The user's resolved effective permissions.
 * @returns A new value with all forbidden fields absent.
 */
export function redactResponse<T>(
  value: T,
  effective: EffectivePermissions,
): T {
  const denied = deniedFieldKeys(effective);
  const combined = new Set<string>([...denied, ...UNIVERSAL_DENIED_FIELD_KEYS]);
  return redactFieldsDeep(value, combined);
}

// ---------------------------------------------------------------------------
// 7. Role classification helpers (for redactor selection).
// ---------------------------------------------------------------------------

/**
 * Returns true if the user's role set triggers the Worker financial-deny
 * ceiling (DEC-063). Convenience wrapper for role-based redactor
 * selection.
 */
export function isSubjectToWorkerCeiling(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
): boolean {
  return assignedRoleCodes.some((rc) => isWorkerRole(rc));
}

/**
 * Returns the denied field keys for a user, combining the Worker ceiling
 * (if applicable) with universal secret fields. Convenience wrapper for
 * callers that need the set directly (e.g. for SQL column projection).
 *
 * Use this BEFORE querying the DB to select only allowed columns — this
 * is the "select only allowed fields" step of Backend Enforcement §11.
 * Selecting forbidden columns and then redacting them in memory is a
 * fetch-then-hide anti-pattern (Contract 11 §11, §19).
 */
export function deniedFieldKeysForUser(
  effective: EffectivePermissions,
): ReadonlySet<string> {
  const denied = deniedFieldKeys(effective);
  return new Set<string>([...denied, ...UNIVERSAL_DENIED_FIELD_KEYS]);
}

// ---------------------------------------------------------------------------
// 8. Re-export the field-key set for convenience.
// ---------------------------------------------------------------------------

export { WORKER_DENIED_FIELD_KEYS } from "./worker-financial-deny";
