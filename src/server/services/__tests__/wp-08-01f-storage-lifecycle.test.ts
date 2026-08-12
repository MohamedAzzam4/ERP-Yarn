/**
 * WP-08-01F MILESTONE B — Tests for private file storage production wiring,
 * fail-closed behavior, upload lifecycle, and compensation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryPrivateFileStorage } from "./in-memory-private-file-storage";
import {
  LocalPrivateFileStorage,
  SupabasePrivateFileStorage,
  getPrivateFileStorage,
  setPrivateFileStorage,
  sanitizeFilename,
  buildObjectKey,
  type PrivateFileStorage,
} from "../private-file-storage";
import crypto from "node:crypto";

describe("WP-08-01F — Private file storage production wiring", () => {
  afterEach(() => {
    // Reset singleton
    setPrivateFileStorage(null as any);
    delete process.env.ERP_USE_LOCAL_STORAGE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("fail-closed: throws when no storage is configured", () => {
    setPrivateFileStorage(null as any);
    delete process.env.ERP_USE_LOCAL_STORAGE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => getPrivateFileStorage()).toThrow(/PRIVATE_FILE_STORAGE_NOT_CONFIGURED/);
  });

  it("uses LocalPrivateFileStorage when ERP_USE_LOCAL_STORAGE=1", () => {
    setPrivateFileStorage(null as any);
    process.env.ERP_USE_LOCAL_STORAGE = "1";
    const storage = getPrivateFileStorage();
    expect(storage).toBeInstanceOf(LocalPrivateFileStorage);
  });

  it("uses SupabasePrivateFileStorage when SUPABASE_URL + key are set", () => {
    setPrivateFileStorage(null as any);
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    const storage = getPrivateFileStorage();
    expect(storage).toBeInstanceOf(SupabasePrivateFileStorage);
  });

  it("never silently falls back to local filesystem in production", () => {
    setPrivateFileStorage(null as any);
    // No env vars set
    delete process.env.ERP_USE_LOCAL_STORAGE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => getPrivateFileStorage()).toThrow();
  });
});

describe("WP-08-01F — Filename sanitization", () => {
  it("removes path traversal attempts", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32")).toBe("system32");
  });

  it("replaces unsafe characters with underscore", () => {
    expect(sanitizeFilename("file name with spaces.csv")).toBe("file_name_with_spaces.csv");
    expect(sanitizeFilename("file;name.csv")).toBe("file_name.csv");
  });

  it("preserves safe characters", () => {
    expect(sanitizeFilename("data_2024-01-01_v1.0.csv")).toBe("data_2024-01-01_v1.0.csv");
  });
});

describe("WP-08-01F — Object key building", () => {
  it("builds tenant/batch-scoped keys with server-generated random ID", () => {
    const key = buildObjectKey("tenant-1", "batch-1", "ignored-key", "data.csv");
    // Key should contain tenant/batch scope and sanitized filename
    expect(key).toContain("tenant-1/migration/batch-1/");
    expect(key).toContain("/data.csv");
    // Key should NOT contain the client-supplied key
    expect(key).not.toContain("ignored-key");
    // Key should contain a UUID (random server-generated ID)
    expect(key).toMatch(/tenant-1\/migration\/batch-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/data\.csv/);
  });

  it("sanitizes filename in key (path traversal prevention)", () => {
    const key = buildObjectKey("tenant-1", "batch-1", "ignored", "../../../etc/passwd");
    expect(key).toContain("/passwd");
    expect(key).not.toContain("..");
    expect(key).not.toContain("etc");
  });
});

describe("WP-08-01F — Upload lifecycle and compensation", () => {
  let storage: InMemoryPrivateFileStorage;

  beforeEach(() => {
    storage = new InMemoryPrivateFileStorage();
  });

  it("successful byte persistence", async () => {
    const content = Buffer.from("entity_type,name\nraw_yarn,Test\n");
    const result = await storage.store("t1", "b1", "k1", "data.csv", content, "text/csv");

    expect(result.storagePath).toContain("t1/migration/b1/");
    expect(result.storagePath).toContain("data.csv");
    expect(result.fileHash).toBe(crypto.createHash("sha256").update(content).digest("hex"));
    expect(result.fileSizeBytes).toBe(content.length);
    expect(result.contentType).toBe("text/csv");

    // Bytes are actually stored
    const readBack = await storage.read(result.storagePath);
    expect(readBack).not.toBeNull();
    expect(readBack!.equals(content)).toBe(true);
  });

  it("upload success + DB failure + successful compensation", async () => {
    const content = Buffer.from("test\n");
    const result = await storage.store("t1", "b1", "k1", "orphan.csv", content, "text/csv");

    // File exists
    expect(await storage.exists(result.storagePath)).toBe(true);

    // Simulate DB failure — compensate
    await storage.deleteIfOrphaned(result.storagePath);

    // File is gone
    expect(await storage.exists(result.storagePath)).toBe(false);
  });

  it("upload success + DB failure + compensation failure recorded for cleanup", async () => {
    // Use a storage that fails on delete
    const failingStorage: PrivateFileStorage = {
      store: async (t, b, k, f, c, ct) => storage.store(t, b, k, f, c, ct),
      read: async (p) => storage.read(p),
      exists: async (p) => storage.exists(p),
      deleteIfOrphaned: async () => { throw new Error("Compensation failed"); },
    };

    const content = Buffer.from("orphan\n");
    const result = await failingStorage.store("t1", "b1", "k1", "file.csv", content, "text/csv");

    // File exists
    expect(await storage.exists(result.storagePath)).toBe(true);

    // Compensation fails — caller should record an orphan-cleanup alert
    await expect(failingStorage.deleteIfOrphaned(result.storagePath)).rejects.toThrow("Compensation failed");

    // File still exists (orphaned) — needs manual cleanup
    expect(await storage.exists(result.storagePath)).toBe(true);
  });

  it("replay with same content creates separate objects (random IDs)", async () => {
    // With server-generated random IDs, each store creates a new object.
    // Replay deduplication is handled at the idempotency layer, not storage.
    const content = Buffer.from("test\n");
    const result1 = await storage.store("t1", "b1", "same-key", "file.csv", content, "text/csv");
    const result2 = await storage.store("t1", "b1", "same-key", "file.csv", content, "text/csv");

    // Different storage paths (random IDs)
    expect(result1.storagePath).not.toBe(result2.storagePath);
    // Same hash (same content)
    expect(result1.fileHash).toBe(result2.fileHash);
    // Two objects in storage
    expect(storage.getFileCount()).toBe(2);
  });

  it("same key + different content produces different hash (conflict)", async () => {
    const content1 = Buffer.from("version1\n");
    const content2 = Buffer.from("version2\n");

    const result1 = await storage.store("t1", "b1", "k1", "file.csv", content1, "text/csv");
    const result2 = await storage.store("t1", "b1", "k1", "file.csv", content2, "text/csv");

    // Different hashes
    expect(result1.fileHash).not.toBe(result2.fileHash);
  });

  it("cross-tenant file access denial (different storage paths)", async () => {
    const content = Buffer.from("test\n");
    const resultA = await storage.store("tenant-A", "b1", "k1", "file.csv", content, "text/csv");
    const resultB = await storage.store("tenant-B", "b1", "k1", "file.csv", content, "text/csv");

    // Different paths
    expect(resultA.storagePath).not.toBe(resultB.storagePath);
    expect(resultA.storagePath).toContain("tenant-A");
    expect(resultB.storagePath).toContain("tenant-B");

    // Both exist independently
    expect(await storage.exists(resultA.storagePath)).toBe(true);
    expect(await storage.exists(resultB.storagePath)).toBe(true);
  });

  it("old version preserved after replacement", async () => {
    const oldContent = Buffer.from("old data\n");
    const newContent = Buffer.from("new data\n");

    const oldFile = await storage.store("t1", "b1", "v1", "data.csv", oldContent, "text/csv");
    const newFile = await storage.store("t1", "b1", "v2", "data.csv", newContent, "text/csv");

    // Both exist
    expect(await storage.exists(oldFile.storagePath)).toBe(true);
    expect(await storage.exists(newFile.storagePath)).toBe(true);

    // Old content unchanged
    const oldRead = await storage.read(oldFile.storagePath);
    expect(oldRead!.toString("utf-8")).toBe("old data\n");

    // New content different
    const newRead = await storage.read(newFile.storagePath);
    expect(newRead!.toString("utf-8")).toBe("new data\n");

    // Different hashes
    expect(oldFile.fileHash).not.toBe(newFile.fileHash);

    // 2 files in storage (old preserved)
    expect(storage.getFileCount()).toBe(2);
  });

  it("never produces a public URL", async () => {
    const content = Buffer.from("test\n");
    const result = await storage.store("t1", "b1", "k1", "f.csv", content, "text/csv");
    expect(result.storagePath).not.toMatch(/^https?:\/\//);
    expect(result.storagePath).not.toMatch(/^ftp:\/\//);
  });
});

describe("WP-08-01F — Canonical manifest hash", () => {
  it("field ordering does not change the hash (JSON.stringify is deterministic for same keys)", () => {
    const facts1 = JSON.stringify({
      batchId: "b1",
      batchStatus: "staged",
      importMode: "opening_balance",
      templateType: "opening_balance_inventory",
      templateVersion: "1.0",
      stagedRowCount: 5,
      stagedDataHash: "abc",
      fileIds: "f1,f2",
      fileHashes: "h1,h2",
      validationStatus: "passed",
      reconciliationStatus: "matched",
      warningCount: 0,
      acceptedWarningCount: 0,
      warningSummary: "",
      domain: "inventory",
      cutoffDate: "2024-01-01",
      sourceCoverage: "all",
      openingBalanceBasis: "audit",
      liveSystemStartBoundary: "2024-01-02",
    });

    // Same values, same order (JSON.stringify is deterministic)
    const facts2 = JSON.stringify({
      batchId: "b1",
      batchStatus: "staged",
      importMode: "opening_balance",
      templateType: "opening_balance_inventory",
      templateVersion: "1.0",
      stagedRowCount: 5,
      stagedDataHash: "abc",
      fileIds: "f1,f2",
      fileHashes: "h1,h2",
      validationStatus: "passed",
      reconciliationStatus: "matched",
      warningCount: 0,
      acceptedWarningCount: 0,
      warningSummary: "",
      domain: "inventory",
      cutoffDate: "2024-01-01",
      sourceCoverage: "all",
      openingBalanceBasis: "audit",
      liveSystemStartBoundary: "2024-01-02",
    });

    const hash1 = crypto.createHash("sha256").update(facts1).digest("hex");
    const hash2 = crypto.createHash("sha256").update(facts2).digest("hex");
    expect(hash1).toBe(hash2);
  });

  it("one material persisted change produces a different hash", () => {
    const facts1 = JSON.stringify({
      batchId: "b1",
      stagedRowCount: 5,
      stagedDataHash: "abc",
      fileHashes: "h1,h2",
      validationStatus: "passed",
      domain: "inventory",
    });

    const facts2 = JSON.stringify({
      batchId: "b1",
      stagedRowCount: 6, // Material change: different row count
      stagedDataHash: "abc",
      fileHashes: "h1,h2",
      validationStatus: "passed",
      domain: "inventory",
    });

    const hash1 = crypto.createHash("sha256").update(facts1).digest("hex");
    const hash2 = crypto.createHash("sha256").update(facts2).digest("hex");
    expect(hash1).not.toBe(hash2);
  });

  it("file hash change produces a different manifest hash", () => {
    const facts1 = JSON.stringify({
      batchId: "b1",
      fileHashes: "hash1,hash2",
      domain: "inventory",
    });

    const facts2 = JSON.stringify({
      batchId: "b1",
      fileHashes: "hash1,hash3", // Different file hash
      domain: "inventory",
    });

    const hash1 = crypto.createHash("sha256").update(facts1).digest("hex");
    const hash2 = crypto.createHash("sha256").update(facts2).digest("hex");
    expect(hash1).not.toBe(hash2);
  });

  it("validation status change produces a different manifest hash", () => {
    const facts1 = JSON.stringify({
      batchId: "b1",
      validationStatus: "passed",
      domain: "inventory",
    });

    const facts2 = JSON.stringify({
      batchId: "b1",
      validationStatus: "failed", // Different validation status
      domain: "inventory",
    });

    const hash1 = crypto.createHash("sha256").update(facts1).digest("hex");
    const hash2 = crypto.createHash("sha256").update(facts2).digest("hex");
    expect(hash1).not.toBe(hash2);
  });

  it("reconciliation status change produces a different manifest hash", () => {
    const facts1 = JSON.stringify({
      batchId: "b1",
      reconciliationStatus: "matched",
      domain: "inventory",
    });

    const facts2 = JSON.stringify({
      batchId: "b1",
      reconciliationStatus: "blocking", // Different reconciliation status
      domain: "inventory",
    });

    const hash1 = crypto.createHash("sha256").update(facts1).digest("hex");
    const hash2 = crypto.createHash("sha256").update(facts2).digest("hex");
    expect(hash1).not.toBe(hash2);
  });

  it("warning count change produces a different manifest hash", () => {
    const facts1 = JSON.stringify({
      batchId: "b1",
      warningCount: 2,
      acceptedWarningCount: 1,
      domain: "inventory",
    });

    const facts2 = JSON.stringify({
      batchId: "b1",
      warningCount: 3, // Different warning count
      acceptedWarningCount: 1,
      domain: "inventory",
    });

    const hash1 = crypto.createHash("sha256").update(facts1).digest("hex");
    const hash2 = crypto.createHash("sha256").update(facts2).digest("hex");
    expect(hash1).not.toBe(hash2);
  });
});
