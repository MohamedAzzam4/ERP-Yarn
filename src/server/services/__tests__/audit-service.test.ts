/**
 * WP-01-03 tests — audit service.
 * Contract: DEC-024 (append-only + transaction-coupled).
 */
import { describe, it, expect } from "vitest";
import { appendAuditLog, InProcessAuditStore, type AuditLogInput } from "../audit-service";
import { AuditWriteFailedError, ServiceError } from "../errors";
import { UNIVERSAL_DENIED_FIELD_KEYS } from "@/server/security/redaction";

describe("appendAuditLog — basic write", () => {
  it("appends a single audit log row", async () => {
    const store = new InProcessAuditStore();
    await appendAuditLog(store, "tenant-1", "user-1", {
      entityType: "sales_order", entityId: "so-1", actionType: "approve", reason: "Approved by Owner",
    });
    expect(store.count()).toBe(1);
    const row = store.getRows()[0]!;
    expect(row.tenantId).toBe("tenant-1");
    expect(row.userId).toBe("user-1");
    expect(row.entityType).toBe("sales_order");
    expect(row.actionType).toBe("approve");
  });

  it("stores old/new values JSON", async () => {
    const store = new InProcessAuditStore();
    await appendAuditLog(store, "t1", "u1", {
      entityType: "inventory_movement", actionType: "create",
      oldValuesJson: { qty: 0 }, newValuesJson: { qty: 100 },
    });
    const row = store.getRows()[0]!;
    expect(row.oldValuesJson).toEqual({ qty: 0 });
    expect(row.newValuesJson).toEqual({ qty: 100 });
  });

  it("nulls out missing optional fields", async () => {
    const store = new InProcessAuditStore();
    await appendAuditLog(store, "t1", "u1", { entityType: "test", actionType: "test" });
    const row = store.getRows()[0]!;
    expect(row.entityId).toBeNull();
    expect(row.oldValuesJson).toBeNull();
    expect(row.reason).toBeNull();
  });
});

describe("appendAuditLog — secret redaction (DEC-024)", () => {
  it("strips password from newValuesJson before writing", async () => {
    const store = new InProcessAuditStore();
    await appendAuditLog(store, "t1", "u1", {
      entityType: "user", actionType: "create",
      newValuesJson: { name: "alice", password: "secret123" },
    });
    expect(store.getRows()[0]!.newValuesJson).toEqual({ name: "alice" });
  });

  it("strips secret_key from oldValuesJson", async () => {
    const store = new InProcessAuditStore();
    await appendAuditLog(store, "t1", "u1", {
      entityType: "settings", actionType: "update",
      oldValuesJson: { secret_key: "old-leak" }, newValuesJson: { secret_key: "new-leak" },
    });
    expect(store.getRows()[0]!.oldValuesJson).toEqual({});
    expect(store.getRows()[0]!.newValuesJson).toEqual({});
  });

  it("strips database_url, connection_string, api_key", async () => {
    const store = new InProcessAuditStore();
    await appendAuditLog(store, "t1", "u1", {
      entityType: "settings", actionType: "update",
      newValuesJson: { database_url: "postgres://...", connection_string: "redis://...", api_key: "key-123", normal_field: "kept" },
    });
    expect(store.getRows()[0]!.newValuesJson).toEqual({ normal_field: "kept" });
  });

  it("strips nested secrets", async () => {
    const store = new InProcessAuditStore();
    await appendAuditLog(store, "t1", "u1", {
      entityType: "user", actionType: "create",
      newValuesJson: { profile: { name: "alice", password: "secret" }, config: { session_token: "leak", key: "data" } },
    });
    expect(store.getRows()[0]!.newValuesJson).toEqual({ profile: { name: "alice" }, config: { key: "data" } });
  });

  it("verifies every universal secret field is stripped", async () => {
    const store = new InProcessAuditStore();
    const newValues: Record<string, unknown> = {};
    for (const f of UNIVERSAL_DENIED_FIELD_KEYS) newValues[f] = `leak-${f}`;
    newValues.kept = "visible";
    await appendAuditLog(store, "t1", "u1", { entityType: "test", actionType: "test", newValuesJson: newValues });
    expect(Object.keys(store.getRows()[0]!.newValuesJson as Record<string, unknown>).sort()).toEqual(["kept"]);
  });
});

describe("appendAuditLog — transaction coupling (DEC-024)", () => {
  it("throws AuditWriteFailedError when the underlying write fails", async () => {
    const store = new InProcessAuditStore();
    store.setShouldFail(true);
    await expect(appendAuditLog(store, "t1", "u1", { entityType: "test", actionType: "test" })).rejects.toThrow(AuditWriteFailedError);
  });

  it("AuditWriteFailedError is a ServiceError with code AUDIT_WRITE_FAILED", async () => {
    const store = new InProcessAuditStore();
    store.setShouldFail(true);
    try {
      await appendAuditLog(store, "t1", "u1", { entityType: "test", actionType: "test" });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuditWriteFailedError);
      expect(e).toBeInstanceOf(ServiceError);
      expect((e as AuditWriteFailedError).code).toBe("AUDIT_WRITE_FAILED");
      expect((e as AuditWriteFailedError).httpStatus).toBe(500);
    }
  });

  it("failed audit write does not store a row (transaction rollback)", async () => {
    const store = new InProcessAuditStore();
    store.setShouldFail(true);
    await expect(appendAuditLog(store, "t1", "u1", { entityType: "test", actionType: "test" })).rejects.toThrow();
    expect(store.count()).toBe(0);
  });
});

describe("appendAuditLog — append-only invariant (no update/delete)", () => {
  it("the audit service module exports NO update or delete function", async () => {
    const mod = await import("../audit-service");
    const exports = Object.keys(mod);
    expect(exports).toContain("appendAuditLog");
    expect(exports).not.toContain("updateAuditLog");
    expect(exports).not.toContain("deleteAuditLog");
    expect(exports).not.toContain("softDeleteAuditLog");
  });

  it("the InProcessAuditStore has NO update or delete method", () => {
    const store = new InProcessAuditStore();
    expect(typeof store.insertAuditLog).toBe("function");
    expect((store as unknown as Record<string, unknown>).updateAuditLog).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).deleteAuditLog).toBeUndefined();
  });
});

describe("appendAuditLog — tenant/user from context", () => {
  it("tenantId and userId come from function arguments, NOT from input body", async () => {
    const store = new InProcessAuditStore();
    await appendAuditLog(store, "tenant-from-context", "user-from-context", {
      entityType: "test", actionType: "test", newValuesJson: { data: "x" },
    });
    const row = store.getRows()[0]!;
    expect(row.tenantId).toBe("tenant-from-context");
    expect(row.userId).toBe("user-from-context");
  });
});
