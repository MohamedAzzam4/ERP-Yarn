/**
 * Deterministic service error codes.
 *
 * Contract: docs/contracts/09_api_contracts.md §7 "Standard Response and
 *   Error Behavior"
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md
 *   "no SQL/stack/secret leakage in errors"
 *
 * WP-01-03 scope: error codes + error classes for the audit/idempotency/
 * document-sequence services.
 */
import "server-only";
import { redactFieldsDeep, UNIVERSAL_DENIED_FIELD_KEYS } from "@/server/security/redaction";

export const SERVICE_ERROR_CODES = [
  "AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED",
  "STATE_CONFLICT", "SUBJECT_CHANGED", "IDEMPOTENCY_CONFLICT",
  "OPERATION_IN_PROGRESS", "STOCK_INSUFFICIENT", "RESERVATION_INVALID",
  "QUALITY_BLOCKED", "WIP_INSUFFICIENT", "RETURN_QTY_EXCEEDED",
  "SETTLEMENT_CONFLICT", "BLOCKING_MIGRATION_ERRORS", "DEPENDENCY_CONFLICT",
  "INTERNAL_TRANSACTION_FAILED", "SERVICE_UNAVAILABLE", "OWNER_DECISION_REQUIRED",
  "IDEMPOTENCY_KEY_REQUIRED", "AUDIT_WRITE_FAILED", "SEQUENCE_ALLOCATION_FAILED",
] as const;

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

export const ERROR_CODE_HTTP_STATUS: Record<ServiceErrorCode, number> = {
  AUTH_REQUIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_FAILED: 422,
  STATE_CONFLICT: 409, SUBJECT_CHANGED: 409, IDEMPOTENCY_CONFLICT: 409,
  OPERATION_IN_PROGRESS: 409, STOCK_INSUFFICIENT: 409, RESERVATION_INVALID: 409,
  QUALITY_BLOCKED: 409, WIP_INSUFFICIENT: 409, RETURN_QTY_EXCEEDED: 409,
  SETTLEMENT_CONFLICT: 409, BLOCKING_MIGRATION_ERRORS: 409, DEPENDENCY_CONFLICT: 409,
  INTERNAL_TRANSACTION_FAILED: 500, SERVICE_UNAVAILABLE: 503,
  OWNER_DECISION_REQUIRED: 409, IDEMPOTENCY_KEY_REQUIRED: 422,
  AUDIT_WRITE_FAILED: 500, SEQUENCE_ALLOCATION_FAILED: 500,
};

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly httpStatus: number;
  readonly context?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(
    code: ServiceErrorCode,
    message: string,
    opts?: { context?: Record<string, unknown>; requestId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = ERROR_CODE_HTTP_STATUS[code];
    this.context = opts?.context
      ? redactFieldsDeep(opts.context, UNIVERSAL_DENIED_FIELD_KEYS)
      : undefined;
    this.requestId = opts?.requestId;
    if (opts?.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }

  toSafeJson(): { code: ServiceErrorCode; message: string; context?: Record<string, unknown>; request_id?: string } {
    return {
      code: this.code,
      message: this.message,
      ...(this.context ? { context: this.context } : {}),
      ...(this.requestId ? { request_id: this.requestId } : {}),
    };
  }
}

export class IdempotencyKeyRequiredError extends ServiceError {
  constructor(opts?: { requestId?: string }) {
    super("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required for this operation.", opts);
  }
}

export class IdempotencyConflictError extends ServiceError {
  readonly idempotencyKey: string;
  constructor(idempotencyKey: string, opts?: { requestId?: string }) {
    super("IDEMPOTENCY_CONFLICT", "Idempotency key was already used with a different request body.",
      { ...opts, context: { idempotency_key: idempotencyKey } });
    this.idempotencyKey = idempotencyKey;
  }
}

export class OperationInProgressError extends ServiceError {
  readonly idempotencyKey: string;
  readonly leaseExpiresAt?: Date;
  constructor(idempotencyKey: string, leaseExpiresAt?: Date, opts?: { requestId?: string }) {
    super("OPERATION_IN_PROGRESS", "The same idempotent operation is still processing.",
      { ...opts, context: { idempotency_key: idempotencyKey, ...(leaseExpiresAt ? { lease_expires_at: leaseExpiresAt.toISOString() } : {}) } });
    this.idempotencyKey = idempotencyKey;
    this.leaseExpiresAt = leaseExpiresAt;
  }
}

export class AuditWriteFailedError extends ServiceError {
  constructor(opts?: { cause?: unknown; requestId?: string }) {
    super("AUDIT_WRITE_FAILED", "Required audit write failed; transaction rolled back.", opts);
  }
}

export class SequenceAllocationFailedError extends ServiceError {
  readonly documentType: string;
  readonly year: number;
  constructor(documentType: string, year: number, opts?: { cause?: unknown; requestId?: string; reason?: string }) {
    super("SEQUENCE_ALLOCATION_FAILED", "Document sequence allocation failed.",
      { ...opts, context: { document_type: documentType, year, ...(opts?.reason ? { reason: opts.reason } : {}) } });
    this.documentType = documentType;
    this.year = year;
  }
}

export class ClientDocumentNumberRejectedError extends ServiceError {
  readonly providedField: string;
  constructor(providedField: string, opts?: { requestId?: string }) {
    super("VALIDATION_FAILED", "Client-provided document number is not accepted. Document numbers are server-allocated.",
      { ...opts, context: { provided_field: providedField } });
    this.providedField = providedField;
  }
}
