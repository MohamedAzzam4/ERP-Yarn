/**
 * WP-08-01E — Complaint linked-entity parsing/resolution helper.
 *
 * Extracted from createComplaintAction so the parsing and tenant-safe
 * resolution of linkedEntityType + linkedEntityId can be directly unit-
 * tested without mocking the entire Next.js runtime.
 *
 * Contract 10 §7.3: Complaints must be linked to at least one entity.
 * The production form submits BOTH linkedEntityType AND linkedEntityId
 * (as "type:id" in the option value). This helper validates the pair
 * and resolves it to a ComplaintService input field — it does NOT infer
 * the type by scanning unrelated tables.
 */
import "server-only";
import type { ComplaintPriority, CreateComplaintInput } from "./complaint-service";
import type { QualityReturnScreenQueryService, LinkedEntityOptionDto } from "./quality-return-screen-query-service";

/** Entity types supported by the complaint form UI. */
export const SUPPORTED_COMPLAINT_ENTITY_TYPES = [
  "customer",
  "sale",
  "item",
  "quality_test",
  "yarn_lot",
] as const;

export type SupportedComplaintEntityType = (typeof SUPPORTED_COMPLAINT_ENTITY_TYPES)[number];

/** Result of successful parsing + resolution. */
export interface ResolvedComplaintLink {
  /** The entity type that was resolved. */
  entityType: SupportedComplaintEntityType;
  /** The entity ID that was resolved. */
  entityId: string;
  /** The ComplaintService input field name (e.g. "customerId"). */
  fieldName: "customerId" | "saleId" | "itemId" | "qualityTestId" | "yarnLotId";
}

/** Error thrown when parsing or resolution fails. Always before idempotency claim. */
export class ComplaintLinkValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ComplaintLinkValidationError";
    this.code = code;
  }
}

/**
 * Parse and validate the linkedEntityType + linkedEntityId pair from the
 * form submission. Does NOT touch the database — pure parsing/validation.
 *
 * @returns The parsed type and ID (not yet resolved against the DB).
 * @throws ComplaintLinkValidationError if parsing fails.
 */
export function parseComplaintLink(
  linkedEntityType: string,
  linkedEntityIdRaw: string,
): { type: SupportedComplaintEntityType; id: string } {
  if (!linkedEntityType) {
    throw new ComplaintLinkValidationError(
      "MISSING_LINKED_ENTITY_TYPE",
      "VALIDATION_FAILED: linkedEntityType is required.",
    );
  }

  if (!linkedEntityIdRaw) {
    throw new ComplaintLinkValidationError(
      "MISSING_LINKED_ENTITY_ID",
      "VALIDATION_FAILED: linkedEntityId is required.",
    );
  }

  if (!SUPPORTED_COMPLAINT_ENTITY_TYPES.includes(linkedEntityType as SupportedComplaintEntityType)) {
    throw new ComplaintLinkValidationError(
      "UNSUPPORTED_ENTITY_TYPE",
      `VALIDATION_FAILED: unsupported linkedEntityType '${linkedEntityType}'. Supported: ${SUPPORTED_COMPLAINT_ENTITY_TYPES.join(", ")}.`,
    );
  }

  const colonIdx = linkedEntityIdRaw.indexOf(":");
  if (colonIdx < 0) {
    throw new ComplaintLinkValidationError(
      "MALFORMED_ENTITY_ID",
      "VALIDATION_FAILED: linkedEntityId must be in 'type:id' format.",
    );
  }

  const submittedType = linkedEntityIdRaw.substring(0, colonIdx);
  const submittedId = linkedEntityIdRaw.substring(colonIdx + 1);

  if (submittedType !== linkedEntityType) {
    throw new ComplaintLinkValidationError(
      "TYPE_MISMATCH",
      `VALIDATION_FAILED: linkedEntityType '${linkedEntityType}' does not match the entity ID type '${submittedType}'.`,
    );
  }

  if (!submittedId) {
    throw new ComplaintLinkValidationError(
      "EMPTY_ENTITY_ID",
      "VALIDATION_FAILED: linkedEntityId contains an empty ID.",
    );
  }

  return {
    type: linkedEntityType as SupportedComplaintEntityType,
    id: submittedId,
  };
}

/**
 * Resolve a parsed type/ID pair against the tenant-scoped linked entities.
 * This is the ownership validation: cross-tenant or nonexistent IDs are rejected.
 *
 * @param parsed The parsed type/ID from parseComplaintLink.
 * @param linkedEntities The tenant-scoped entities from listLinkedEntitiesForWorker.
 * @returns The resolved link with the ComplaintService field name.
 * @throws ComplaintLinkValidationError if the type/ID pair is not found.
 */
export function resolveComplaintLink(
  parsed: { type: SupportedComplaintEntityType; id: string },
  linkedEntities: LinkedEntityOptionDto[],
): ResolvedComplaintLink {
  const matched = linkedEntities.find(
    (e) => e.entityType === parsed.type && e.entityId === parsed.id,
  );
  if (!matched) {
    throw new ComplaintLinkValidationError(
      "ENTITY_NOT_FOUND",
      "VALIDATION_FAILED: linkedEntityId not found in tenant scope for the given type (cross-tenant, nonexistent, or type mismatch).",
    );
  }

  const fieldName = mapEntityTypeToField(parsed.type);
  return {
    entityType: parsed.type,
    entityId: parsed.id,
    fieldName,
  };
}

/**
 * Map a supported entity type to the ComplaintService input field name.
 */
function mapEntityTypeToField(
  type: SupportedComplaintEntityType,
): ResolvedComplaintLink["fieldName"] {
  switch (type) {
    case "customer":
      return "customerId";
    case "sale":
      return "saleId";
    case "item":
      return "itemId";
    case "quality_test":
      return "qualityTestId";
    case "yarn_lot":
      return "yarnLotId";
    default:
      // Exhaustiveness check — if a new type is added to the union but
      // not handled here, TypeScript will error at compile time.
      const _exhaustive: never = type;
      throw new ComplaintLinkValidationError(
        "UNSUPPORTED_ENTITY_TYPE",
        `VALIDATION_FAILED: unsupported linked entity type '${_exhaustive}'.`,
      );
  }
}

/**
 * Apply a resolved link to a ComplaintService input object.
 * Sets only the matching field; all other link fields remain undefined.
 */
export function applyResolvedLinkToInput(
  input: CreateComplaintInput,
  resolved: ResolvedComplaintLink,
): CreateComplaintInput {
  return {
    ...input,
    [resolved.fieldName]: resolved.entityId,
  };
}
