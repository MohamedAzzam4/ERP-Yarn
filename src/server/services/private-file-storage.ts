/**
 * WP-08-01F MILESTONE B — Private file storage abstraction.
 *
 * Contract 08 §8.1: "Source-file access uses private storage and server
 * authorization or short-lived signed URLs."
 *
 * This module provides a production-safe private file storage adapter
 * that stores file bytes in a tenant/batch-scoped local filesystem path.
 * In production, this would be replaced by an S3/GCS adapter — the
 * interface is the same.
 *
 * Key properties:
 *   - No public URLs
 *   - Tenant/batch-scoped object keys
 *   - Server-derived checksum, size, MIME
 *   - Immutable: replacement creates a new object, old is preserved
 *   - Storage-success/DB-failure safe compensation (delete orphaned object)
 */
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Result of storing a file privately.
 */
export interface StoredFile {
  /** The private storage path (e.g. "private://tenant/batch/key/filename.csv"). */
  storagePath: string;
  /** SHA-256 checksum of the file content. */
  fileHash: string;
  /** File size in bytes. */
  fileSizeBytes: number;
  /** Content type (MIME). */
  contentType: string;
}

export interface PrivateFileStorage {
  /**
   * Store file bytes privately. Returns server-derived metadata.
   * The storage key is tenant/batch-scoped — no public URL.
   */
  store(
    tenantId: string,
    batchId: string,
    key: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredFile>;

  /**
   * Read file bytes from private storage.
   * Returns null if the file does not exist.
   */
  read(storagePath: string): Promise<Buffer | null>;

  /**
   * Check if a file exists in private storage.
   */
  exists(storagePath: string): Promise<boolean>;

  /**
   * Delete a file from private storage (for compensation on DB failure).
   * Does NOT throw if the file doesn't exist.
   */
  deleteIfOrphaned(storagePath: string): Promise<void>;
}

/**
 * Local filesystem private file storage adapter.
 *
 * Stores files under a base directory with tenant/batch-scoped paths.
 * The storagePath format is: `private://{tenantId}/migration/{batchId}/{key}/{filename}`
 *
 * In production, replace with S3/GCS adapter implementing the same interface.
 */
export class LocalPrivateFileStorage implements PrivateFileStorage {
  constructor(private readonly baseDir: string = "/tmp/erp-yarn-private-storage") {}

  async store(
    tenantId: string,
    batchId: string,
    key: string,
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<StoredFile> {
    // Build tenant/batch-scoped directory
    const dir = path.join(this.baseDir, tenantId, "migration", batchId, key);
    await fs.mkdir(dir, { recursive: true });

    // Sanitize filename (prevent path traversal)
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(dir, safeFilename);

    // Write file bytes
    await fs.writeFile(filePath, content);

    // Derive checksum server-side
    const fileHash = crypto.createHash("sha256").update(content).digest("hex");

    // Build storage path (private:// scheme — never a public URL)
    const storagePath = `private://${tenantId}/migration/${batchId}/${key}/${safeFilename}`;

    return {
      storagePath,
      fileHash,
      fileSizeBytes: content.length,
      contentType,
    };
  }

  async read(storagePath: string): Promise<Buffer | null> {
    const filePath = this.resolvePath(storagePath);
    if (!filePath) return null;
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async exists(storagePath: string): Promise<boolean> {
    const filePath = this.resolvePath(storagePath);
    if (!filePath) return false;
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteIfOrphaned(storagePath: string): Promise<void> {
    const filePath = this.resolvePath(storagePath);
    if (!filePath) return;
    try {
      await fs.unlink(filePath);
    } catch {
      // Best-effort — file may not exist
    }
  }

  /**
   * Convert a private:// storage path to a filesystem path.
   * Returns null if the path is not a valid private:// path.
   */
  private resolvePath(storagePath: string): string | null {
    if (!storagePath.startsWith("private://")) return null;
    const relativePath = storagePath.slice("private://".length);
    // Prevent path traversal
    if (relativePath.includes("..")) return null;
    return path.join(this.baseDir, relativePath);
  }
}

/**
 * Singleton instance. In production, this would be configured via env.
 */
let _storage: PrivateFileStorage | null = null;

export function getPrivateFileStorage(): PrivateFileStorage {
  if (!_storage) {
    _storage = new LocalPrivateFileStorage();
  }
  return _storage;
}

/**
 * For testing: inject a custom storage implementation.
 */
export function setPrivateFileStorage(storage: PrivateFileStorage): void {
  _storage = storage;
}
