/**
 * WP-01-03 tests — document sequence allocation service.
 * Contract: 03 §7.5, 09 §5.
 */
import { describe, it, expect } from "vitest";
import {
  allocateDocumentNumberWithLock, formatDocNo, rejectClientDocumentNumber,
  CLIENT_DOCUMENT_NUMBER_FIELDS, InProcessDocumentSequenceStore,
  SequenceAllocationFailedError, ClientDocumentNumberRejectedError,
} from "../document-sequence-service";

const TENANT_A = "tenant-A";
const TENANT_B = "tenant-B";

describe("formatDocNo", () => {
  it("formats with 6-digit padding", () => {
    expect(formatDocNo("RC", 2026, 1)).toBe("RC-2026-000001");
    expect(formatDocNo("RC", 2026, 42)).toBe("RC-2026-000042");
    expect(formatDocNo("RC", 2026, 999999)).toBe("RC-2026-999999");
  });
  it("does NOT truncate numbers exceeding 6 digits", () => {
    expect(formatDocNo("RC", 2026, 1000000)).toBe("RC-2026-1000000");
  });
});

describe("allocateDocumentNumber — basic allocation", () => {
  it("allocates the first number (1) for a new sequence", async () => {
    const store = new InProcessDocumentSequenceStore();
    const result = await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 });
    expect(result.sequenceNumber).toBe(1);
    expect(result.docNo).toBe("RC-2026-000001");
  });

  it("allocates sequential numbers 1, 2, 3, 4, 5", async () => {
    const store = new InProcessDocumentSequenceStore();
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 }));
    }
    expect(results.map((r) => r.docNo)).toEqual(["RC-2026-000001", "RC-2026-000002", "RC-2026-000003", "RC-2026-000004", "RC-2026-000005"]);
  });

  it("uses the default prefix", async () => {
    const store = new InProcessDocumentSequenceStore();
    const result = await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "sales_order", year: 2026 });
    expect(result.prefix).toBe("SO");
  });

  it("uses an explicit prefix if provided", async () => {
    const store = new InProcessDocumentSequenceStore();
    const result = await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "custom_type", year: 2026 }, "CUSTOM");
    expect(result.prefix).toBe("CUSTOM");
  });

  it("throws SequenceAllocationFailedError for unknown document type with no default", async () => {
    const store = new InProcessDocumentSequenceStore();
    await expect(allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "unknown_type_no_default", year: 2026 })).rejects.toThrow(SequenceAllocationFailedError);
  });
});

describe("allocateDocumentNumber — tenant isolation", () => {
  it("each tenant has an independent sequence", async () => {
    const store = new InProcessDocumentSequenceStore();
    await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 });
    await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 });
    const result = await allocateDocumentNumberWithLock(store, { tenantId: TENANT_B, documentType: "raw_receipt", year: 2026 });
    expect(result.sequenceNumber).toBe(1);
    expect(store.peekLastNumber(TENANT_A, "raw_receipt", 2026)).toBe(2);
    expect(store.peekLastNumber(TENANT_B, "raw_receipt", 2026)).toBe(1);
  });

  it("same tenant, different document types are independent", async () => {
    const store = new InProcessDocumentSequenceStore();
    await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 });
    const result = await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "sales_order", year: 2026 });
    expect(result.sequenceNumber).toBe(1);
  });

  it("same tenant, same type, different years are independent", async () => {
    const store = new InProcessDocumentSequenceStore();
    await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2025 });
    await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2025 });
    const result = await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 });
    expect(result.sequenceNumber).toBe(1);
  });
});

describe("allocateDocumentNumber — concurrency safety", () => {
  it("concurrent allocations produce unique numbers (no duplicates)", async () => {
    const store = new InProcessDocumentSequenceStore();
    const promises = Array.from({ length: 50 }, () => allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 }));
    const results = await Promise.all(promises);
    expect(new Set(results.map((r) => r.docNo)).size).toBe(50);
    expect(store.peekLastNumber(TENANT_A, "raw_receipt", 2026)).toBe(50);
  });

  it("concurrent allocations produce sequential numbers 1-50 (no gaps)", async () => {
    const store = new InProcessDocumentSequenceStore();
    const promises = Array.from({ length: 50 }, () => allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 }));
    const results = await Promise.all(promises);
    expect(results.map((r) => r.sequenceNumber).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("concurrent allocations across tenants do not interfere", async () => {
    const store = new InProcessDocumentSequenceStore();
    const promisesA = Array.from({ length: 30 }, () => allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 }));
    const promisesB = Array.from({ length: 20 }, () => allocateDocumentNumberWithLock(store, { tenantId: TENANT_B, documentType: "raw_receipt", year: 2026 }));
    const [resultsA, resultsB] = await Promise.all([Promise.all(promisesA), Promise.all(promisesB)]);
    expect(new Set(resultsA.map((r) => r.sequenceNumber)).size).toBe(30);
    expect(new Set(resultsB.map((r) => r.sequenceNumber)).size).toBe(20);
    expect(store.peekLastNumber(TENANT_A, "raw_receipt", 2026)).toBe(30);
    expect(store.peekLastNumber(TENANT_B, "raw_receipt", 2026)).toBe(20);
  });
});

describe("allocateDocumentNumber — pre-seeded sequences", () => {
  it("continues from a pre-seeded last_number", async () => {
    const store = new InProcessDocumentSequenceStore();
    store.preSeed(TENANT_A, "raw_receipt", 2026, "RC", 99);
    const result = await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 });
    expect(result.sequenceNumber).toBe(100);
    expect(result.docNo).toBe("RC-2026-000100");
  });

  it("uses the pre-seeded prefix, not the default", async () => {
    const store = new InProcessDocumentSequenceStore();
    store.preSeed(TENANT_A, "raw_receipt", 2026, "CUSTOM", 0);
    const result = await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "raw_receipt", year: 2026 });
    expect(result.prefix).toBe("CUSTOM");
  });
});

describe("rejectClientDocumentNumber (Contract 09 §5)", () => {
  it("rejects doc_no in request body", () => {
    expect(() => rejectClientDocumentNumber({ doc_no: "RC-2026-000001" })).toThrow(ClientDocumentNumberRejectedError);
  });

  it("rejects docNo, document_number, documentNumber, sequence_number, sequenceNumber", () => {
    for (const field of ["docNo", "document_number", "documentNumber", "sequence_number", "sequenceNumber"]) {
      expect(() => rejectClientDocumentNumber({ [field]: "x" })).toThrow(ClientDocumentNumberRejectedError);
    }
  });

  it("does NOT reject bodies without document number fields", () => {
    expect(() => rejectClientDocumentNumber({ sale_id: "s1", amount: 100 })).not.toThrow();
  });

  it("ClientDocumentNumberRejectedError has code VALIDATION_FAILED and httpStatus 422", () => {
    try {
      rejectClientDocumentNumber({ doc_no: "x" });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as ClientDocumentNumberRejectedError).code).toBe("VALIDATION_FAILED");
      expect((e as ClientDocumentNumberRejectedError).httpStatus).toBe(422);
    }
  });

  it("CLIENT_DOCUMENT_NUMBER_FIELDS contains all expected field names", () => {
    expect(CLIENT_DOCUMENT_NUMBER_FIELDS.has("doc_no")).toBe(true);
    expect(CLIENT_DOCUMENT_NUMBER_FIELDS.has("docNo")).toBe(true);
    expect(CLIENT_DOCUMENT_NUMBER_FIELDS.has("document_number")).toBe(true);
  });
});

describe("SequenceAllocationFailedError", () => {
  it("has code SEQUENCE_ALLOCATION_FAILED and httpStatus 500", async () => {
    const store = new InProcessDocumentSequenceStore();
    await expect(allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "unknown_no_default", year: 2026 })).rejects.toMatchObject({
      code: "SEQUENCE_ALLOCATION_FAILED", httpStatus: 500,
    });
  });

  it("includes documentType and year in context", async () => {
    const store = new InProcessDocumentSequenceStore();
    try {
      await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "unknown_no_default", year: 2026 });
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as SequenceAllocationFailedError;
      expect(err.documentType).toBe("unknown_no_default");
      expect(err.year).toBe(2026);
      expect(err.context?.document_type).toBe("unknown_no_default");
      expect(err.context?.year).toBe(2026);
    }
  });

  it("toSafeJson() does not include SQL or stack", async () => {
    const store = new InProcessDocumentSequenceStore();
    try {
      await allocateDocumentNumberWithLock(store, { tenantId: TENANT_A, documentType: "unknown_no_default", year: 2026 });
      expect.fail("should have thrown");
    } catch (e) {
      const json = (e as SequenceAllocationFailedError).toSafeJson();
      expect(JSON.stringify(json)).not.toMatch(/SELECT|INSERT|UPDATE|DELETE|sql|stack|trace/i);
      expect(JSON.stringify(json)).not.toMatch(/password|secret|token|key/i);
    }
  });
});
