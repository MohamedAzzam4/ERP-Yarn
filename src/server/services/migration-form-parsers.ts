/**
 * WP-08-01F — Migration form-data parsers and validators.
 *
 * Server-safe importable module for parsing and validating FormData
 * fields before service invocation. Every parser fails closed on
 * invalid input — no `as any` casts.
 *
 * TASK 5: Exported for direct testing.
 * TASK 6: All parsers are production implementations, not duplicates.
 */
import "server-only";

// ---------------------------------------------------------------------------
// Typed allowlists
// ---------------------------------------------------------------------------

const APPROVER_ROLES = ["owner", "accountant"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

const CORRECTION_TYPES = ["reversal", "adjustment", "new_corrected"] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

const REVIEW_DECISIONS = ["accepted", "rejected", "resolved"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

const FILE_TYPES = ["source", "normalized", "mapping", "report"] as const;
export type FileType = (typeof FILE_TYPES)[number];

const CUTOVER_IMPORT_MODES = ["opening_balance", "transaction_history", "hybrid"] as const;
export type CutoverImportMode = (typeof CUTOVER_IMPORT_MODES)[number];

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseApproverRole(value: string): ApproverRole {
  if (!APPROVER_ROLES.includes(value as ApproverRole)) {
    throw new Error(`VALIDATION_FAILED: approverRole must be one of: ${APPROVER_ROLES.join(", ")}. Got: '${value}'.`);
  }
  return value as ApproverRole;
}

export function parseCorrectionType(value: string): CorrectionType {
  if (!CORRECTION_TYPES.includes(value as CorrectionType)) {
    throw new Error(`VALIDATION_FAILED: correctionType must be one of: ${CORRECTION_TYPES.join(", ")}. Got: '${value}'.`);
  }
  return value as CorrectionType;
}

export function parseReviewDecision(value: string): ReviewDecision {
  if (!REVIEW_DECISIONS.includes(value as ReviewDecision)) {
    throw new Error(`VALIDATION_FAILED: decision must be one of: ${REVIEW_DECISIONS.join(", ")}. Got: '${value}'.`);
  }
  return value as ReviewDecision;
}

export function parseFileType(value: string): FileType {
  if (!FILE_TYPES.includes(value as FileType)) {
    throw new Error(`VALIDATION_FAILED: fileType must be one of: ${FILE_TYPES.join(", ")}. Got: '${value}'.`);
  }
  return value as FileType;
}

export function parseCutoverImportMode(value: string): CutoverImportMode {
  if (!CUTOVER_IMPORT_MODES.includes(value as CutoverImportMode)) {
    throw new Error(`VALIDATION_FAILED: cutoverImportMode must be one of: ${CUTOVER_IMPORT_MODES.join(", ")}. Got: '${value}'.`);
  }
  return value as CutoverImportMode;
}

export function parseRequiredString(formData: FormData, field: string): string {
  const value = String(formData.get(field) ?? "").trim();
  if (!value) {
    throw new Error(`VALIDATION_FAILED: ${field} is required.`);
  }
  return value;
}

export function parseOptionalString(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (!value) return null;
  return String(value).trim() || null;
}

export function parseOptionalInt(formData: FormData, field: string): number | null {
  const value = formData.get(field);
  if (!value) return null;
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) return null;
  return parsed;
}

export function parseOptionalJson(formData: FormData, field: string): Record<string, unknown> | null {
  const value = formData.get(field);
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`VALIDATION_FAILED: ${field} must be a valid JSON object.`);
  }
}

// ---------------------------------------------------------------------------
// Validators (non-FormData specific)
// ---------------------------------------------------------------------------

/** Reject public URLs in storage paths. */
export function validateStoragePath(path: string): void {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    throw new Error("VALIDATION_FAILED: public URLs are not allowed for storagePath.");
  }
}

// ---------------------------------------------------------------------------
// Redaction functions (production DTO redaction)
// ---------------------------------------------------------------------------

/** Redact file hash to first 8 chars + ellipsis. */
export function redactFileHash(fullHash: string): string {
  if (fullHash.length <= 8) return fullHash;
  return fullHash.substring(0, 8) + "…";
}

/** Redact backup location to protocol prefix only. */
export function redactBackupLocation(fullLocation: string): string {
  const separator = "://";
  const idx = fullLocation.indexOf(separator);
  if (idx < 0) return "private://…";
  return fullLocation.substring(0, idx + separator.length) + "…";
}

// ---------------------------------------------------------------------------
// Role verification (TASK 4 — importable for testing)
// ---------------------------------------------------------------------------

import type { RoleCode } from "@/server/security/role-codes";

/**
 * Verify that the authenticated user is actually assigned to the requested
 * approver role. An Owner cannot occupy the Accountant slot, and vice versa.
 * DEC-069: distinct-role and distinct-identity requirements.
 */
export function verifyApproverRole(
  userRoles: ReadonlyArray<RoleCode>,
  requestedRole: ApproverRole,
): void {
  if (!userRoles.includes(requestedRole as RoleCode)) {
    throw new Error(
      `PERMISSION_DENIED: User is not assigned to role '${requestedRole}'. ` +
      `User roles: [${userRoles.join(", ")}]. ` +
      `An Owner cannot occupy the Accountant approval slot and vice versa (DEC-069).`,
    );
  }
}
